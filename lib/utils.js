'use strict';

const _ = require('lodash');

const getCrossOrigin = (url = '', host = '') => {
    // Check for the same origin & relative links
    if (url.includes(`://${host}`) || !url.includes('://')) {
        return '';
    }
    return 'crossorigin';
};

const getPreloadAttributes = ({
    assetUrl,
    host,
    asAttribute,
    corsCheck = false,
    noPush = true // Disable HTTP/2 Push behaviour until digest spec is implemented by most browsers
}) => {
    return (
        assetUrl &&
        `<${assetUrl}>; rel="preload"; as="${asAttribute}"; ${
            noPush ? 'nopush;' : ''
        } ${corsCheck ? getCrossOrigin(assetUrl, host) : ''}`.trim()
    );
};

// Early preloading of primary fragments assets to improve Performance
const getFragmentAssetsToPreload = (styleRefs, scriptRefs, { host } = {}) => {
    let assetsToPreload = [];

    // Handle Server rendered fragments without depending on assets
    if (scriptRefs.length === 0 && styleRefs.length === 0) {
        return assetsToPreload;
    }

    for (const uri of styleRefs) {
        assetsToPreload.push(
            getPreloadAttributes({
                assetUrl: uri,
                asAttribute: 'style'
            })
        );
    }

    for (const uri of scriptRefs) {
        assetsToPreload.push(
            getPreloadAttributes({
                assetUrl: uri,
                asAttribute: 'script',
                corsCheck: true,
                host
            })
        );
    }

    return assetsToPreload;
};

const nextIndexGenerator = (initialIndex, step) => {
    let index = initialIndex;

    return () => {
        let pastIndex = index;
        index += step;
        return pastIndex;
    };
};

const assignHeaders = (to, from) => {
    from = Object.assign({}, from);
    if (to['set-cookie'] !== undefined && from['set-cookie'] !== undefined) {
        from['set-cookie'] = _.uniqBy(
            from['set-cookie'].concat(to['set-cookie']),
            v => {
                const m = v.match(/^(.+?)=/);
                if (m && m[1]) {
                    return m[1].trim();
                }

                return v;
            }
        );
    }

    return Object.assign(to, from);
};

module.exports = {
    getCrossOrigin,
    getFragmentAssetsToPreload,
    nextIndexGenerator,
    assignHeaders
};
