'use strict';

const path = require('path');
const EventEmitter = require('events').EventEmitter;
const requestHandler = require('./lib/request-handler');
const fetchTemplate = require('./lib/fetch-template');
const parseTemplate = require('./lib/parse-template');
const requestFragment = require('./lib/request-fragment');
const filterReqHeadersFn = require('./lib/filter-headers');
const { initTracer } = require('./lib/tracing');

const AMD_LOADER_URL =
    'https://cdnjs.cloudflare.com/ajax/libs/require.js/2.1.22/require.min.js';

module.exports = class Tailor extends EventEmitter {
    constructor(options) {
        super();
        const {
            amdLoaderUrl = AMD_LOADER_URL,
            filterRequestHeaders = options.filterHeaders || filterReqHeadersFn,
            maxAssetLinks,
            templatesPath
        } = options;

        options.maxAssetLinks = isNaN(maxAssetLinks)
            ? 1
            : Math.max(1, maxAssetLinks);

        const requestOptions = Object.assign(
            {
                amdLoaderUrl,
                fetchContext: () => Promise.resolve({}),
                fetchTemplate: fetchTemplate(
                    templatesPath || path.join(process.cwd(), 'templates')
                ),
                fragmentTag: 'fragment',
                handledTags: [],
                handleTag: () => '',
                requestFragment: requestFragment(filterRequestHeaders),
                botsGuardEnabled: false
            },
            options
        );

        initTracer(options.tracer);

        requestOptions.parseTemplate = parseTemplate(
            [requestOptions.fragmentTag].concat(requestOptions.handledTags),
            ['script', requestOptions.fragmentTag]
        );

        this.requestHandler = requestHandler.bind(this, requestOptions);
    }
};
