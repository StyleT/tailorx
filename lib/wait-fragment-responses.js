'use strict';

class WaitForFragmentResponses {
    #promises = [];

    waitFor(fragment) {
        const p = new Promise(function(resolve) {
            fragment.on('response', function(statusCode, headers) {
                resolve([fragment.attributes, headers]);
            });
            fragment.on('error', function() {
                resolve(null);
            });
        });

        this.#promises.push(p);
    }

    all() {
        return Promise.all(this.#promises).then(values =>
            values.filter(v => v !== null)
        );
    }
}

module.exports = WaitForFragmentResponses;
