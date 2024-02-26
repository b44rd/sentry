import * as Sentry from '@nativescript-community/sentry';
import * as Tracing from '@nativescript-community/sentry/tracing';
import { Application, NavigatedData, Page, Trace, Utils, View } from '@nativescript/core';
import { on as applicationOn, launchEvent } from '@nativescript/core/application';
import Vue from 'nativescript-vue';
import Home from './views/Home';

Trace.addCategories(Sentry.SentryTraceCategory);
Trace.enable();


async function startSentry() {
    try {
        Sentry.init({
            dsn: SENTRY_DSN,
            debug: true,
            enablePerformanceV2: true,
            release: `${__APP_ID__}@${__APP_VERSION__}+${__APP_BUILD_NUMBER__}`,
            dist: `${__APP_BUILD_NUMBER__}.${__ANDROID__ ? 'android' : 'ios'}`,
            flushSendEvent: true,
            enableNativeCrashHandling: true,
            attachScreenshot: true,
            tracesSampleRate: 1.0,
            sampleRate: 1.0,
            enableAutoPerformanceTracking: true,
            enableAutoSessionTracking: true,
            integrations: [
                new Tracing.NativescriptTracing({
                    enableAppStartTracking: true,
                    enableNativeFramesTracking: true,
                    // routingInstrumentation: HttpService.sentryTracing,
                    enableStallTracking: true,
                }),
            ],
            enableUIViewControllerTracing: false,
            enableUserInteractionTracing: false,
            enableAutoBreadcrumbTracking: false,
        });
        Page.on('navigatingTo', (event: NavigatedData) => {
            Sentry.addBreadcrumb({
                category: 'navigation',
                type: 'navigation',
                // We assume that context.name is the name of the route.
                message: `Navigation to ${event.object}`,
                data: {
                    isBackNavigation: event.isBackNavigation,
                    from: `${(event.object as Page).frame?.currentPage}`,
                    to: `${event.object}`
                }
            });
        });
        View.on('showingModally', (event: NavigatedData) => {
            Sentry.addBreadcrumb({
                category: 'navigation',
                type: 'navigation',
                // We assume that context.name is the name of the route.
                message: `Navigation to Modal ${event.object}`,
                data: {
                    from: `${(event.object as View)._modalParent}`,
                    to: `${event.object}`
                }
            });
        });
        View.on('closingModally', (event: NavigatedData) => {
            Sentry.addBreadcrumb({
                category: 'navigation',
                type: 'navigation',
                // We assume that context.name is the name of the route.
                message: `Closing modal ${event.object}`,
                data: {
                    from: `${event.object as View}`
                }
            });
        });
        setTimeout(()=>{
            Sentry.withScope(scope => {
                try {
                    scope.setTag('myTag', 'tag-value');
                    scope.setExtra('myExtra', 'extra-value');
                    scope.addBreadcrumb({ message: 'test' });
                    Sentry.captureMessage('Hello Sentry!');
                } catch (error) {
                    console.error(error);
                }
            });
        }, 1000);
    } catch(err){console.error(err, err.stack);}

}

if (!__ANDROID__ || Utils.android.getApplicationContext()) {
    startSentry();
} else {
    applicationOn(launchEvent, startSentry);

}

new Vue({
    render: h => h('frame', [h(Home)])
}).$start();
