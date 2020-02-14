'use strict';
const Transform = require('./transform');

/**
 * Parse both base and child templates
 *
 * @param {Array} handledTags - Tags that should be treated specially and will be handled in the future
 * @param {Array} insertBeforePipeTags - Pipe definition will be inserted before these tags
 * @returns {Promise} Promise that resolves to a serialized array consisting of buffer and fragment objects
 */
module.exports = handledTags => {
    const transform = new Transform(handledTags);

    return (baseTemplate, childTemplate, fullRendering = true) =>
        Promise.resolve().then(() =>
            transform.applyTransforms(
                baseTemplate,
                childTemplate,
                fullRendering
            )
        );
};
