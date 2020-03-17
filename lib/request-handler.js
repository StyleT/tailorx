'use strict';

const errors = require('./errors');

const AsyncStream = require('./streams/async-stream');
const ContentLengthStream = require('./streams/content-length-stream');
const HeadInjectorStream = require('./streams/head-injector-stream');
const BotsGuardStream = require('./streams/seobots-guard-stream');
const processTemplate = require('./process-template');
const {
    getFragmentAssetsToPreload,
    nextIndexGenerator,
    assignHeaders
} = require('./utils');
const WaitForFragmentResponses = require('./wait-fragment-responses');

const { globalTracer, Tags, FORMAT_HTTP_HEADERS } = require('opentracing');
const tracer = globalTracer();

// Events emitted by fragments on the template
const FRAGMENT_EVENTS = [
    'start',
    'response',
    'end',
    'error',
    'timeout',
    'warn'
];
// Occurs when Template parsing fails/Primary Fragment Errors out
const INTERNAL_SERVER_ERROR = 'Internal Server Error';

/**
 * Process the HTTP Request to the Tailor Middleware
 *
 * @param {Object} options - Options object passed to Tailor
 * @param {Object} request - HTTP request stream of Middleware
 * @param {Object} response - HTTP response stream of middleware
 */
module.exports = function processRequest(options, request, response) {
    this.emit('start', request);
    const parentSpanContext = tracer.extract(
        FORMAT_HTTP_HEADERS,
        request.headers
    );
    const spanOptions = parentSpanContext ? { childOf: parentSpanContext } : {};
    const span = tracer.startSpan('compose_page', spanOptions);
    span.addTags({
        [Tags.HTTP_URL]: request.url,
        [Tags.SPAN_KIND]: Tags.SPAN_KIND_RPC_SERVER
    });

    const {
        fetchContext,
        fetchTemplate,
        parseTemplate,
        filterResponseHeaders,
        maxAssetLinks,
        getAssetsToPreload,
        botsGuardEnabled
    } = options;

    const waitFragmentsRes = new WaitForFragmentResponses();

    const asyncStream = new AsyncStream();
    asyncStream.once('plugged', () => {
        asyncStream.end();
    });

    const contextPromise = fetchContext(request).catch(err => {
        this.emit('context:error', request, err);
        return {};
    });
    const templatePromise = fetchTemplate(request, parseTemplate);
    const responseHeaders = {
        // Disable cache in browsers and proxies
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        Pragma: 'no-cache',
        'Content-Type': 'text/html'
    };

    let shouldWriteHead = true;

    const contentLengthStream = new ContentLengthStream(contentLength => {
        this.emit('end', request, contentLength);
        span.finish();
    });

    const botGuard = new BotsGuardStream(
        botsGuardEnabled,
        request.headers,
        response
    );
    botGuard.on('error', err => {
        shouldWriteHead = false;
        handleError(err);
    });

    const handleError = err => {
        span.setTag(Tags.ERROR, true);
        span.log({ message: err.message, stack: err.stack });

        if (shouldWriteHead) {
            shouldWriteHead = false;

            if (this.listeners('error').length > 0) {
                this.emit('error', request, err, response);
            } else {
                response.writeHead(500, responseHeaders);
                if (typeof err.presentable === 'string') {
                    response.end(`${err.presentable}`);
                } else {
                    response.end(INTERNAL_SERVER_ERROR);
                }
            }

            span.setTag(Tags.HTTP_STATUS_CODE, 500);

            span.finish();
        } else {
            if (this.listeners('error').length > 0) {
                this.emit('error', request, err);
            }

            contentLengthStream.end();
        }
    };

    const handlePrimaryFragment = (fragment, resultStream) => {
        if (!shouldWriteHead) {
            return;
        }

        shouldWriteHead = false;

        fragment.once('response', async (statusCode, headers) => {
            // Map response headers
            if (typeof filterResponseHeaders === 'function') {
                (await waitFragmentsRes.all()).forEach(v =>
                    assignHeaders(responseHeaders, filterResponseHeaders(...v))
                );

                assignHeaders(
                    responseHeaders,
                    filterResponseHeaders(fragment.attributes, headers)
                );
            }

            if (headers.location) {
                responseHeaders.location = headers.location;
            }

            // Make resources early discoverable while processing HTML
            let assetsToPreload = getFragmentAssetsToPreload(
                fragment.styleRefs,
                fragment.scriptRefs,
                request.headers
            );

            const configAssets = await getAssetsToPreload(request);
            assetsToPreload = getFragmentAssetsToPreload(
                configAssets.styleRefs || [],
                configAssets.scriptRefs || [],
                request.headers
            ).concat(assetsToPreload);

            responseHeaders.link = assetsToPreload.join(',');
            this.emit('response', request, statusCode, responseHeaders);

            const headInjector = new HeadInjectorStream(headers);

            resultStream.writeHead(statusCode, responseHeaders);
            resultStream
                .pipe(headInjector)
                .pipe(contentLengthStream)
                .pipe(response);
        });

        fragment.once('error', origErr => {
            const err = new errors.FragmentError({
                message: `Fragment error for "${fragment.attributes.id}"`,
                cause: origErr,
                data: { fragmentAttrs: fragment.attributes }
            });

            span.addTags({
                [Tags.ERROR]: true,
                [Tags.HTTP_STATUS_CODE]: 500
            });
            span.log({
                message: err.message,
                stack: err.stack
            });

            if (this.listeners('error').length > 0) {
                this.emit('error', request, err, response);
            } else {
                response.writeHead(500, responseHeaders);
                response.end(INTERNAL_SERVER_ERROR);
            }

            span.finish();
        });
    };

    Promise.all([templatePromise, contextPromise])
        .then(([parsedTemplate, context]) => {
            // extendedOptions are mutated inside processTemplate
            const extendedOptions = Object.assign({}, options, {
                nextIndex: nextIndexGenerator(0, maxAssetLinks),
                parentSpan: span,
                asyncStream
            });

            const resultStream = processTemplate(
                request,
                extendedOptions,
                context
            );
            let isFragmentFound = false;

            resultStream.pipe(botGuard);

            resultStream.on('fragment:found', fragment => {
                isFragmentFound = true;

                botGuard.addFragment(fragment);

                const { attributes } = fragment;
                FRAGMENT_EVENTS.forEach(eventName => {
                    fragment.once(eventName, (...args) => {
                        const prefixedName = 'fragment:' + eventName;
                        this.emit(prefixedName, request, attributes, ...args);
                    });
                });

                attributes.returnHeaders && waitFragmentsRes.waitFor(fragment);

                attributes.primary && handlePrimaryFragment(fragment, botGuard);
            });

            resultStream.once('finish', async () => {
                const statusCode = botGuard.statusCode || 200;
                if (shouldWriteHead) {
                    shouldWriteHead = false;
                    // Preload the loader script when at least
                    // one fragment is present on the page
                    if (isFragmentFound) {
                        const configAssets = await getAssetsToPreload(request);
                        const assetsToPreload = getFragmentAssetsToPreload(
                            configAssets.styleRefs || [],
                            configAssets.scriptRefs || [],
                            request.headers
                        ).join(',');

                        if (typeof filterResponseHeaders === 'function') {
                            (await waitFragmentsRes.all()).forEach(v =>
                                assignHeaders(
                                    responseHeaders,
                                    filterResponseHeaders(...v)
                                )
                            );
                        }

                        assetsToPreload !== '' &&
                            (responseHeaders.link = assetsToPreload);
                    }
                    this.emit('response', request, statusCode, responseHeaders);

                    botGuard.writeHead(statusCode, responseHeaders);
                    botGuard.pipe(contentLengthStream).pipe(response);
                }
            });

            resultStream.once('error', handleError);

            parsedTemplate.forEach(item => resultStream.write(item));
            resultStream.end();
        })
        .catch(err => {
            handleError(err);
        });
};
