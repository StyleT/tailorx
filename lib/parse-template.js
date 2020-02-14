'use strict';
const transform = new (require('./transform'))();

/**
 * Parse both base and child templates
 *
 * @param {Array} handledTags - Tags that should be treated specially and will be handled in the future
 * @param {Array} insertBeforePipeTags - Pipe definition will be inserted before these tags
 * @returns {Promise} Promise that resolves to a serialized array consisting of buffer and fragment objects
 */
module.exports = handledTags => (
    baseTemplate,
    childTemplate,
    fullRendering = true
) =>
    Promise.resolve().then(() =>
        transform
            .setHandleTags(handledTags)
            .applyTransforms(baseTemplate, childTemplate, fullRendering)
    );
