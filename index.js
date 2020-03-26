'use strict';

const path = require('path');
const EventEmitter = require('events').EventEmitter;
const requestHandler = require('./lib/request-handler');
const fetchTemplate = require('./lib/fetch-template');
const parseTemplate = require('./lib/parse-template');
const requestFragment = require('./lib/request-fragment');
const filterReqHeadersFn = require('./lib/filter-headers');
const { initTracer } = require('./lib/tracing');

module.exports = class Tailor extends EventEmitter {
    constructor(options) {
        super();
        const {
            filterRequestHeaders = options.filterHeaders || filterReqHeadersFn,
            maxAssetLinks,
            templatesPath
        } = options;

        options.maxAssetLinks = isNaN(maxAssetLinks)
            ? 1
            : Math.max(1, maxAssetLinks);

        const requestOptions = Object.assign(
            {
                fetchContext: () => Promise.resolve({}),
                fetchTemplate: fetchTemplate(
                    templatesPath || path.join(process.cwd(), 'templates')
                ),
                fragmentTag: 'fragment',
                handledTags: [],
                baseTemplatesCacheSize: 0,
                handleTag: () => '',
                requestFragment: requestFragment(filterRequestHeaders),
                botsGuardEnabled: false,
                fragmentHooks: {},
                getAssetsToPreload: async () => ({
                    styleRefs: [],
                    scriptRefs: []
                }),
                shouldSetPrimaryFragmentAssetsToPreload: true
            },
            options
        );

        initTracer(options.tracer);

        requestOptions.parseTemplate = parseTemplate(
            [requestOptions.fragmentTag].concat(requestOptions.handledTags),
            requestOptions.baseTemplatesCacheSize
        );

        this.requestHandler = requestHandler.bind(this, requestOptions);
    }
};
