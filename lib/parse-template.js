'use strict';
const Transform = require('./transform');

/**
 * Parse both base and child templates
 *
 * @param {Array} handledTags - Tags that should be treated specially and will be handled in the future
 * @param {Number} maxTemplates - You can limit templates cache size which you want to keep, it relates to how many templates you have in your app
 * @returns {Promise} Promise that resolves to a serialized array consisting of buffer and fragment objects
 */
module.exports = (handledTags, maxTemplates) => {
    const transform = new Transform(handledTags, maxTemplates);

    return (baseTemplate, childTemplate, fullRendering = true) =>
        Promise.resolve().then(() =>
            transform.applyTransforms(
                baseTemplate,
                childTemplate,
                fullRendering
            )
        );
};
