import { Application } from '@nativescript/core';
import { android as androidApp } from '@nativescript/core/application';
import { Breadcrumb, Event, Response, Status, User } from '@sentry/types';
import { NativescriptOptions, _processLevel } from './backend';
import { convertNativescriptFramesToSentryFrames, parseErrorStack } from './integrations/debugsymbolicator';
import { UserFeedback } from './nssentry';
import { rewriteFrameIntegration } from './sdk';

export namespace NSSentry {
    export const nativeClientAvailable = true;
    export const nativeTransport = true;

    function eventLevel(level) {
        switch (level) {
            case 'fatal':
                return io.sentry.SentryLevel.FATAL;
            case 'warning':
                return io.sentry.SentryLevel.WARNING;
            case 'info':
            case 'log':
                return io.sentry.SentryLevel.INFO;
            case 'debug':
                return io.sentry.SentryLevel.DEBUG;
            default:
                return io.sentry.SentryLevel.ERROR;
        }
    }
    function getNativeHashMap(obj: { [k: string]: string }) {
        if (!obj) {
            return null;
        }
        const map = new java.util.HashMap<string, string>();
        Object.keys(obj).forEach((k) => {
            map.put(k, obj[k]);
        });
        return map;
    }
    function getJSHashMap(obj: java.util.HashMap<any, any>) {
        if (!obj) {
            return null;
        }

        const result = {};
        let value, pair, key;

        const it = obj.entrySet().iterator();
        while (it.hasNext()) {
            pair = it.next();
            value = pair.getValue();
            key = pair.getKey();
            if (value instanceof java.util.HashMap) {
                result[key] = getJSHashMap(value);
            } else if (value instanceof java.lang.Number) {
                result[key] = value.doubleValue();
            } else if (value && value.hasOwnProperty('length')) {
                result[key] = Array.from({ length: value.length }).map((v, i) => value[i]);
            } else {
                result[key] = value;
            }
        }

        return result;
    }
    function getUser(user: { [k: string]: any }) {
        const nUser = new io.sentry.protocol.User();
        if (user.email) {
            nUser.setEmail(user.email);
        }
        if (user.userID) {
            nUser.setId(user.userID);
        } else if (user.userId) {
            nUser.setId(user.userId);
        } else if (user.id) {
            nUser.setId(user.id);
        }
        if (user.username) {
            nUser.setUsername(user.username);
        }
        if (user.extra) {
            nUser.setOthers(getNativeHashMap(user.extra));
        }
        return nUser;
    }
    const mJsModuleIdPattern = new RegExp('(?:^|[/\\\\])(\\d+\\.js)$');
    function stackFrameToModuleId(frame: { file?: string }) {
        if (!!frame.file) {
            const matcher = mJsModuleIdPattern.exec(frame.file);
            if (matcher) {
                return matcher[1] + ':';
            }
        }
        return '';
    }
    function convertToNativeStacktrace(
        stack: {
            file?: string;
            filename?: string;
            function?: string;
            methodName?: string;
            column?: number;
            colno?: number;
            lineno?: number;
            lineNumber?: number;
            in_app?: boolean;
        }[]
    ) {
        const nStackTrace = new io.sentry.protocol.SentryStackTrace();
        const frames = new java.util.ArrayList<io.sentry.protocol.SentryStackFrame>();
        for (let i = 0; i < stack.length; i++) {
            const frame = stack[i];

            const fileName = frame.file || frame.filename || '';
            const methodName = frame.methodName || frame.function || '';

            const lineNumber = frame.lineNumber || frame.lineno || 0;
            const column = frame.column || frame.colno || 0;
            const stackFrame = new io.sentry.protocol.SentryStackFrame();
            stackFrame.setModule('');
            stackFrame.setFunction(methodName.length > 0 ? methodName.split('.').pop() : methodName);
            stackFrame.setFilename(stackFrameToModuleId(frame));
            stackFrame.setLineno(new java.lang.Integer(lineNumber));
            stackFrame.setColno(new java.lang.Integer(column));
            stackFrame.setAbsPath(fileName);
            stackFrame.setPlatform('javascript');
            stackFrame.setInApp(new java.lang.Boolean(frame.in_app || false));
            frames.add(stackFrame);
        }
        nStackTrace.setFrames(frames);
        return nStackTrace;
    }
    function addExceptionInterface(nEvent: io.sentry.SentryEvent, type: string, value: string, stack) {
        const exceptions = nEvent.getExceptions() || new java.util.ArrayList<io.sentry.protocol.SentryException>();

        const nException = new io.sentry.protocol.SentryException();
        nException.setType(type);
        nException.setValue(value);
        nException.setModule('');
        // nException.setModule('com.tns');
        nException.setThreadId(new java.lang.Long(java.lang.Thread.currentThread().getId()));

        nException.setStacktrace(convertToNativeStacktrace(stack));
        exceptions.add(nException);
        nEvent.setExceptions(exceptions);
    }
    export function sendEvent(event: Event): Promise<Response> {
        return new Promise((resolve) => {
            // Process and convert deprecated levels
            event.level = event.level ? _processLevel(event.level) : undefined;

            const header = {
                event_id: event.event_id,
                sdk: event.sdk,
            };

            const payload = {
                ...event,
                message: {
                    message: event.message,
                },
            };
            const headerString = JSON.stringify(header);

            const payloadString = JSON.stringify(payload);
            const length = payloadString.length;
            // try {
            //     // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
            //     length = await RNSentry.getStringBytesLength(payloadString);
            // } catch {
            //     // The native call failed, we do nothing, we have payload.length as a fallback
            // }

            const item = {
                content_type: 'application/json',
                length,
                type: payload.type ?? 'event',
            };

            const itemString = JSON.stringify(item);

            const envelopeString = `${headerString}\n${itemString}\n${payloadString}`;
            captureEnvelope(envelopeString);
            if (sentryOptions.flushSendEvent === true) {
                io.sentry.Sentry.flush(0);
            }
            resolve({ status: Status.Success });
        }).catch((err) => {
            console.error('error sending sentry event', err, err.stack);
            return Promise.reject(err);
        }) as any;
    }

    export async function captureEnvelope(envelope: string) {
        const installation = new java.io.File(nSentryOptions.getOutboxPath(), java.util.UUID.randomUUID().toString());
        try {
            const out = new java.io.FileOutputStream(installation);
            out.write(new java.lang.String(envelope).getBytes(java.nio.charset.Charset.forName('UTF-8')));
        } catch(err) {
            console.error('captureEnvelope error', err);
        }
    }

    export function flush(timeout: number) {
        io.sentry.Sentry.flush(timeout);
    }
    let initialized = false;
    let sentryOptions: NativescriptOptions ;
    let nSentryOptions: io.sentry.SentryOptions ;

    function addPackages( event: io.sentry.SentryEvent,  sdk: io.sentry.protocol.SdkVersion) {
        const eventSdk = event.getSdk();
        if (eventSdk != null && eventSdk.getName() === 'sentry.javascript.react-native' && sdk != null) {
            const sentryPackages = sdk.getPackages();
            if (sentryPackages != null) {
                for (let index = 0; index < sentryPackages.size(); index++) {
                    const sentryPackage = sentryPackages.get(index);
                    eventSdk.addPackage(sentryPackage.getName(), sentryPackage.getVersion());

                }
            }
            const integrations = sdk.getIntegrations();
            if (integrations != null) {
                for (let index = 0; index < integrations.size(); index++) {
                    eventSdk.addIntegration(integrations.get(index));

                }
            }
            event.setSdk(eventSdk);
        }
    }
    export function startWithDsnString(dsnString: string, options: NativescriptOptions = {}): Promise<Response> {
        return new Promise((resolve, reject) => {
            if (initialized) {
                console.info('Already started, use existing client', dsnString);
                resolve({ status: Status.Failed });
                return;
            }

            try {
                io.sentry.android.core.SentryAndroid.init(
                    Application.android.context,
                    new io.sentry.Sentry.OptionsConfiguration({
                        configure(config: io.sentry.SentryOptions) {
                            // config.setLogger(new io.sentry.SystemOutLogger());

                            // config.setDiagnosticLevel(io.sentry.SentryLevel.DEBUG);
                            io.sentry.Sentry.setLevel(io.sentry.SentryLevel.DEBUG);
                            config.setDsn(dsnString);
                            if (!!options.environment) {
                                config.setEnvironment(options.environment);
                            } else {
                                config.setEnvironment('javascript');
                            }
                            if (!!options.debug) {
                                config.setDebug(options.debug);
                            }
                            if (!!options.release) {
                                config.setRelease(options.release);
                            }
                            if (!!options.dist) {
                                config.setDist(options.dist);
                            }
                            if (options.enableAutoSessionTracking !== undefined) {
                                config.setEnableSessionTracking(options.enableAutoSessionTracking);
                            }
                            if (options.sessionTrackingIntervalMillis !== undefined) {
                                config.setSessionTrackingIntervalMillis(options.sessionTrackingIntervalMillis);
                            }
                            if (options.enableNdkScopeSync !== undefined) {
                                config.setEnableScopeSync(options.enableNdkScopeSync);
                            }
                            if (options.attachStacktrace !== undefined) {
                                config.setAttachStacktrace(options.attachStacktrace);
                            }
                            if (options.attachThreads !== undefined) {
                                // JS use top level stacktraces and android attaches Threads which hides them so
                                // by default we hide.
                                config.setAttachThreads(options.attachThreads);
                            }
                            if (options.sendDefaultPii !== undefined) {
                                config.setSendDefaultPii(options.sendDefaultPii);
                            }

                            // config.setEnableNdk(true);
                            const integrations = config.getIntegrations();
                            const size = integrations.size();
                            if (options.enableNativeCrashHandling === false) {
                                for (let index = size - 1; index >= 0; index--) {
                                    const inte = integrations.get(index);
                                    if (
                                        inte instanceof io.sentry.UncaughtExceptionHandlerIntegration ||
                                        inte instanceof io.sentry.android.core.AnrIntegration ||
                                        inte instanceof io.sentry.android.core.NdkIntegration
                                    ) {
                                        integrations.remove(index);
                                    }
                                }
                            }
                            config.setBeforeSend(
                                new io.sentry.SentryOptions.BeforeSendCallback({
                                    execute(event, hint) {
                                        if (options.beforeSend) {
                                            // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
                                            options.beforeSend(event as any, hint);
                                        }

                                        if (event.getRequest()) {
                                            const map = new java.util.HashMap();
                                            map.put('X-Forwarded-Protocol', 'https');
                                            event.getRequest().setHeaders(map);
                                        }
                                        // we use this callback to actually try and get the JS stack when a native error is catched
                                        try {
                                            const ex: io.sentry.protocol.SentryException = event.getExceptions().get(0);
                                            if (ex && ex.getType() === 'NativeScriptException') {
                                                let mechanism = event.getThrowable && event.getThrowable();
                                                if (!mechanism) {
                                                    const privateMethod = io.sentry.SentryEvent.class.getDeclaredMethod('getThrowable', null);
                                                    privateMethod.setAccessible(true);
                                                    mechanism = privateMethod.invoke(event, null);
                                                }
                                                let throwable;
                                                if (mechanism instanceof io.sentry.exception.ExceptionMechanismException) {
                                                    throwable = mechanism.getThrowable();
                                                } else if (mechanism instanceof (com as any).tns.NativeScriptException) {
                                                    throwable = mechanism;
                                                }
                                                if (throwable ) {
                                                    const jsStackTrace: string = (throwable ).getIncomingStackTrace();
                                                    if (jsStackTrace) {
                                                        const stack = parseErrorStack({ stack: jsStackTrace } as any);

                                                        const convertedFrames = convertNativescriptFramesToSentryFrames(stack as any);
                                                        convertedFrames.forEach((frame) => rewriteFrameIntegration._iteratee(frame));
                                                        addExceptionInterface(event, 'Error', throwable.getMessage(), convertedFrames.reverse());
                                                    }
                                                }
                                            }
                                        } catch (e) {}
                                        event.setTag('event.origin', 'android');
                                        event.setTag('event.environment', 'nativescript');
                                        addPackages(event, config.getSdkVersion());
                                        return event;
                                    },
                                })
                            );
                            nSentryOptions = config;
                            sentryOptions = options;
                        },
                    })
                );
                initialized = true;
            } catch (e) {
                console.error('Catching on startWithDsnString, calling callback', e.getMessage());
                reject(e);
                return;
            }

            resolve({ status: Status.Success });
        });
    }

    // export function setLogLevel(level: number) {
    //     switch (level) {
    //         case 1:
    //             io.sentry.Sentry.setLevel(null);
    //             break;
    //         case 2:
    //             io.sentry.Sentry.setLevel(io.sentry.SentryLevel.ERROR);
    //             break;
    //         case 3:
    //             io.sentry.Sentry.setLevel(io.sentry.SentryLevel.DEBUG);
    //             break;
    //         case 4:
    //             io.sentry.Sentry.setLevel(io.sentry.SentryLevel.INFO);
    //             break;
    //     }
    // }

    export function fetchNativeSdkInfo () {
        return {};
    }

    export function fetchNativeRelease () {
        const context = androidApp.context;
        const packageInfo = context.getPackageManager().getPackageInfo(context.getPackageName(), 0);
        return {
            'id': packageInfo.packageName,
            'version': packageInfo.versionName,
            'build': packageInfo.versionCode + ''
        };
    }

    export function closeNativeSdk () {
        io.sentry.Sentry.close();
    }

    export function crash() {
        throw new java.lang.RuntimeException('TEST - Sentry Client Crash');
    }
    export function deviceContexts(): Promise<any> {
        return new Promise((resolve) => {
            const nEvent = new io.sentry.SentryEvent();

            const params = {};
            const it = nEvent.getContexts().entrySet().iterator();
            let value, pair, key;
            while (it.hasNext()) {
                pair = it.next();
                value = pair.getValue();
                key = pair.getKey();
                params[key] = getJSHashMap(value);
            }
            resolve(params);
        });
    }

    export function captureUserFeedback(feedback: UserFeedback) {
        const userFeedback = new io.sentry.UserFeedback(new io.sentry.protocol.SentryId(feedback.eventId));
        if (feedback.comments) {
            userFeedback.setComments(feedback.comments);
        }
        if (feedback.email) {
            userFeedback.setEmail(feedback.email);
        }
        if (feedback.name) {
            userFeedback.setName(feedback.name);
        }
        io.sentry.Sentry.captureUserFeedback(userFeedback);
    }


    export function setUser(user: User | null, otherUserKeys) {
        io.sentry.Sentry.configureScope(new io.sentry.ScopeCallback({
            run(scope) {
                if (user == null && otherUserKeys == null) {
                    scope.setUser(null);
                } else {
                    const userInstance = new io.sentry.protocol.User();

                    if (user) {
                        if (user.email) {
                            userInstance.setEmail(user.email);
                        }

                        if (user.id) {
                            userInstance.setId(user.id);
                        }

                        if (user.username) {
                            userInstance.setUsername(user.username);
                        }

                        if (user.ip_address) {
                            userInstance.setIpAddress(user.ip_address);
                        }
                    }

                    if (otherUserKeys ) {
                        userInstance.setOthers(getNativeHashMap(otherUserKeys));
                    }
                    scope.setUser(userInstance);
                }
            }
        }));

    }
    export function setTag(key: string, value: string) {
        io.sentry.Sentry.configureScope(new io.sentry.ScopeCallback({
            run(scope) {
                scope.setTag(key, value);
            }
        }));
    }

    export function setExtra(key: string, extra: string) {
        io.sentry.Sentry.configureScope(new io.sentry.ScopeCallback({
            run(scope) {
                scope.setExtra(key, extra);
            }
        }));
    }

    export function addBreadcrumb(breadcrumb: Breadcrumb, maxBreadcrumbs?: number) {
        io.sentry.Sentry.configureScope(new io.sentry.ScopeCallback({
            run(scope) {
                const breadcrumbInstance = new io.sentry.Breadcrumb();

                if (breadcrumb.message) {
                    breadcrumbInstance.setMessage(breadcrumb.message);
                }

                if (breadcrumb.type) {
                    breadcrumbInstance.setType(breadcrumb.type);
                }

                if (breadcrumb.category) {
                    breadcrumbInstance.setCategory(breadcrumb.category);
                }

                if (breadcrumb.level) {
                    breadcrumbInstance.setLevel(eventLevel(breadcrumb.level));
                }

                if (breadcrumb.data) {
                    Object.keys(breadcrumb.data).forEach(key => {
                        breadcrumbInstance.setData(key, breadcrumb.data[key]);
                    });
                }

                scope.addBreadcrumb(breadcrumbInstance);
            }
        }));
    }
    export function clearBreadcrumbs() {
        io.sentry.Sentry.configureScope(new io.sentry.ScopeCallback({
            run(scope) {
                scope.clearBreadcrumbs();
            }
        }));
    }
    export function setContext(key: string, context: { [key: string]: any } | null) {
        // setContext not available on the Android SDK yet.
        setExtra(key, context?JSON.stringify(context) : null);
    }
}
