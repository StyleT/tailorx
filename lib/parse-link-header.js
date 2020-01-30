'use strict';
/**
 * Parse link headers
 * '<http://example.com/script.js>; rel="fragment-script"'
 *
 * [
 *   {
 *     rel: "fragment-script",
 *     uri: "http://localhost:8080/script.js"
 *   }
 * ]
 *
 * Based on code from parse-link-header!
 * https://github.com/thlorenz/parse-link-header/blob/master/index.js
 */
module.exports = function parseLinkHeader(linkHeader) {
    return fixLink(linkHeader)
        .split(/,\s*</)
        .map(link => {
            const match = link.match(/<?([^>]*)>(.*)/);
            if (!match) {
                return null;
            }
            const linkUrl = match[1];
            return {
                uri: linkUrl,
                rel: getRelValue(match[2])
            };
        })
        .filter(v => v && v.rel != null)
        .reduce((acc, curr) => {
            return acc.concat(curr);
        }, []);
};

/**
 * Get the value of rel attribute
 *
 * rel="fragment-script" -> ["rel", "fragment-script"]
 */
function getRelValue(parts) {
    const m = parts.match(/\s*rel\s*=\s*"?([^"]+)"?/);
    if (!m) {
        return null;
    }
    return m[1];
}

function fixLink(headerLink) {
    return headerLink
        .split(',')
        .map(link => {
            return link
                .split(';')
                .map((attribute, index) => {
                    if (index) {
                        const [key, value] = attribute.trim().split('=');
                        return !value || value.trim().startsWith('"')
                            ? attribute
                            : `${key}="${value}"`;
                    } else {
                        return !attribute || attribute.trim().startsWith('<')
                            ? attribute
                            : `<${attribute}>`;
                    }
                })
                .join(';');
        })
        .join(',');
}
