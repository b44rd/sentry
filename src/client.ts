import { BaseClient, Scope } from '@sentry/core';
import { Event, EventHint } from '@sentry/types';
import { SyncPromise } from '@sentry/utils';

import { NativescriptBackend, NativescriptOptions } from './backend';
import { SDK_NAME, SDK_VERSION } from './version';

/**
 * The Sentry React Native SDK Client.
 *
 * @see NativescriptOptions for documentation on configuration options.
 * @see SentryClient for usage documentation.
 */
export class NativescriptClient extends BaseClient<NativescriptBackend, NativescriptOptions> {
    /**
     * Creates a new React Native SDK instance.
     * @param options Configuration options for this SDK.
     */
    public constructor(options: NativescriptOptions) {
        super(NativescriptBackend, options);
    }

    /**
     * @inheritDoc
     */
    protected _prepareEvent(event: Event, scope?: Scope, hint?: EventHint): SyncPromise<Event | null> {
        // console.log('_prepareEvent', hint);
        event.platform = event.platform || 'javascript';
        event.sdk = {
            ...event.sdk,
            name: SDK_NAME,
            packages: [
                ...((event.sdk && event.sdk.packages) || []),
                {
                    name: 'npm:nativescript-akylas-sentry',
                    version: SDK_VERSION
                }
            ],
            version: SDK_VERSION
        };

        return super._prepareEvent(event, scope, hint) as any;
    }

    /**
     * If native client is available it will trigger a native crash.
     * Use this only for testing purposes.
     */
    public nativeCrash(): void {
        this._getBackend().nativeCrash();
    }
}
