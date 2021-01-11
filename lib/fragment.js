'use strict';

const EventEmitter = require('events').EventEmitter;
const PassThrough = require('stream').PassThrough;
const zlib = require('zlib');
const ContentLengthStream = require('./streams/content-length-stream');
const parseLinkHeader = require('./parse-link-header');

const { globalTracer, Tags } = require('opentracing');
const tracer = globalTracer();

const hasValue = value => {
    if (value || value === '') {
        return true;
    }
    return false;
};

const getFragmentAssetUris = (refs, assetSize) => {
    const scriptUris = [];
    const styleUris = [];

    for (const ref of refs) {
        if (ref.rel === 'fragment-script') {
            scriptUris.push(ref.uri);
        } else if (ref.rel === 'stylesheet') {
            styleUris.push(ref.uri);
        }
    }
    return [scriptUris.slice(0, assetSize), styleUris.slice(0, assetSize)];
};

/**
 * Merge the attributes based on the fragment tag attributes and context
 *
 * @param {object} tag - Fragment tag from the template
 * @param {object=} context - Context object for the given fragment
 * @returns {object}
 */
const getAttributes = (tag, context) => {
    const attributes = Object.assign({}, tag.attributes);
    const fragmentId = attributes.id;

    if (context && fragmentId && context[fragmentId]) {
        const fragmentCtxt = context[fragmentId];
        Object.assign(attributes, fragmentCtxt);
    }

    const {
        src,
        async: isAsync,
        primary,
        public: isPublic,
        timeout,
        'return-headers': returnHeaders,
        'forward-querystring': forwardQuerystring,
        'ignore-invalid-ssl': ignoreInvalidSsl,
        ...rest
    } = attributes;

    return {
        ...rest,
        url: src,
        id: fragmentId,
        async: hasValue(isAsync),
        primary: hasValue(primary),
        public: hasValue(isPublic),
        timeout: parseInt(timeout || 3000, 10),
        returnHeaders: hasValue(returnHeaders),
        forwardQuerystring: hasValue(forwardQuerystring),
        ignoreInvalidSsl: hasValue(ignoreInvalidSsl)
    };
};

/**
 * Class representing a Fragment
 * @extends EventEmitter
 */
module.exports = class Fragment extends EventEmitter {
    /**
     * Create a Fragment
     * @param {Object} tag - Fragment tag from the template
     * @param {object} context - Context object for the given fragment
     * @param {number} index - Order of the fragment
     * @param {function} requestFragment - Function to request the fragment
     * @param {number} maxAssetLinks - Number of `Link` Header directives for CSS and JS respected per fragment
     * @param {object} fragmentHooks
     * @param {function} fragmentHooks.insertStart
     * @param {function} fragmentHooks.insertEnd
     */
    constructor({
        tag,
        context,
        index,
        requestFragment,
        maxAssetLinks,
        fragmentHooks = {}
    } = {}) {
        super();
        this.attributes = getAttributes(tag, context);
        this.index = index;
        this.maxAssetLinks = maxAssetLinks;
        this.requestFragment = requestFragment;
        this.fragmentHooks = fragmentHooks;
        this.stream = new PassThrough();
        this.scriptRefs = [];
        this.styleRefs = [];
    }

    /**
     * Handles fetching the fragment
     * @param {object} request - HTTP request stream
     * @param {object} parentSpan - opentracing Span that will be the parent of the current operation
     * @returns {object} Fragment response streams in case of synchronous fragment or buffer in case of async fragment
     */
    fetch(request, parentSpan = null) {
        this.emit('start');

        let url = this.attributes.url;

        const spanOptions = parentSpan ? { childOf: parentSpan } : {};
        const span = tracer.startSpan('fetch_fragment', spanOptions);

        const {
            id,
            primary,
            async: isAsync,
            public: isPublic,
            timeout
        } = this.attributes;

        span.addTags({
            [Tags.SPAN_KIND]: Tags.SPAN_KIND_RPC_CLIENT,
            [Tags.HTTP_URL]: url,
            public: isPublic,
            async: isAsync,
            id: id || 'unnamed',
            primary,
            timeout
        });

        if (this.attributes.forwardQuerystring) {
            const origUrl = new URL('http://fake' + request.url);
            const fragmentUrl = new URL(url);

            origUrl.searchParams.forEach((v, k) => {
                if (fragmentUrl.searchParams.has(k)) {
                    return;
                }

                fragmentUrl.searchParams.append(k, v);
            });

            url = fragmentUrl.toString();
        }

        this.requestFragment(url, this.attributes, request, span).then(
            res => this.onResponse(res, span),
            err => {
                span.setTag(Tags.ERROR, true);
                span.log({ message: err.message });
                this.emit('error', err);
                this.stream.end();
                span.finish();
            }
        );
        // Async fragments are piped later on the page
        if (isAsync) {
            //TODO: to be implemented
            return Buffer.from(
                '<!-- Async fragments are not fully implemented yet -->'
            );
        }
        return this.stream;
    }

    /**
     * Handle the fragment response
     * @param {object} response - HTTP response stream from fragment
     * @param {object} span - fetch-fragment opentracing span
     */
    onResponse(response, span) {
        const { statusCode, headers } = response;

        // Extract the assets from fragment link headers.
        const refs = parseLinkHeader(
            [headers.link, headers['x-amz-meta-link']].join(',')
        );

        if (refs.length > 0) {
            [this.scriptRefs, this.styleRefs] = getFragmentAssetUris(
                refs,
                this.maxAssetLinks
            );
        }

        this.emit('response', statusCode, headers);

        this.insertStart(headers); //TODO: add error handling for this hook, now it causes UnhandledPromiseRejection

        const contentLengthStream = new ContentLengthStream(contentLength => {
            this.emit('end', contentLength);
        });

        contentLengthStream.on('end', () => {
            this.insertEnd(headers); //TODO: add error handling for this hook, now it causes UnhandledPromiseRejection
            this.stream.end();
            span.finish();
        });

        const handleError = err => {
            this.emit('warn', err);
            span.setTag(Tags.ERROR, true);
            span.log({ message: err.message });
            contentLengthStream.end();
        };

        // Handle errors on all piped streams
        response.on('error', handleError);
        contentLengthStream.on('error', handleError);

        // Unzip the fragment response if gzipped before piping it to the Client(Browser) - Composition will break otherwise
        let responseStream = response;
        const contentEncoding = headers['content-encoding'];
        if (
            contentEncoding &&
            (contentEncoding === 'gzip' || contentEncoding === 'deflate')
        ) {
            let unzipStream = zlib.createUnzip();
            unzipStream.on('error', handleError);
            responseStream = response.pipe(unzipStream);
        }

        responseStream
            .pipe(contentLengthStream)
            .pipe(this.stream, { end: false });
    }

    /**
     * Insert the placeholder for pipe assets and load the required JS and CSS assets at the start of fragment stream
     *
     * - JS assets are loading via AMD(requirejs) for both sync and async fragments
     * - CSS for the async fragments are loaded using custom loadCSS(available in src/pipe.js)
     */
    insertStart(headers) {
        const { async: isAsync, id } = this.attributes;

        this.stream.write(
            `<!-- Fragment #${this.index}${
                this.attributes.id ? ` "${this.attributes.id}"` : ''
            } START -->`
        );

        if (this.fragmentHooks.insertStart) {
            this.fragmentHooks.insertStart(
                this.stream,
                this.attributes,
                headers,
                this.index
            );
        } else {
            this.styleRefs.forEach(uri => {
                this.stream.write(
                    isAsync
                        ? `<!-- Async fragments are not fully implemented yet: ${uri} -->`
                        : `<link rel="stylesheet" href="${uri}"${
                              id !== undefined
                                  ? ` data-fragment-id="${id}"`
                                  : ''
                          }>`
                );
            });
        }
    }

    /**
     * Insert the placeholder for pipe assets at the end of fragment stream
     */
    insertEnd(headers) {
        const { id } = this.attributes;

        if (this.fragmentHooks.insertEnd) {
            this.fragmentHooks.insertEnd(
                this.stream,
                this.attributes,
                headers,
                this.index
            );
        } else {
            this.scriptRefs.reverse().forEach(uri => {
                this.stream.write(
                    `<script type="text/javascript" src="${uri}"${
                        id !== undefined ? ` data-fragment-id="${id}"` : ''
                    }></script>`
                );
            });
        }

        this.stream.write(
            `<!-- Fragment #${this.index}${
                this.attributes.id ? ` "${this.attributes.id}"` : ''
            } END -->`
        );
    }
};
