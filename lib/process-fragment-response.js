'use strict';

/**
 * @param {http.ServerResponse} response - fragment response
 * @param {Object} context - contextual info about request
 * @param {http.IncomingMessage} context.request - incoming request from browser
 * @param {Object} context.fragmentAttributes - fragment attributes map
 * @param {String} context.fragmentUrl - URL that was requested on fragment
 */
module.exports = (response, context) => {
    const isError500 = response.statusCode >= 500;
    const isNonPrimaryAndNon200 =
        (response.statusCode < 200 || response.statusCode >= 300) &&
        !context.fragmentAttributes.primary;

    if (isError500 || isNonPrimaryAndNon200) {
        throw new Error(
            `Request fragment error. statusCode: ${response.statusCode}; statusMessage: ${response.statusMessage}; url: ${context.fragmentUrl};`
        );
    }

    return response;
};
