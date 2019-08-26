'use strict';

const axios = require('axios');

/**
 * Stateless New Relic rest client
 */
class NewRelicClient {
    constructor(apiKey) {
        this.apiKey = apiKey;
        this.NR_API_URL = "https://api.newrelic.com/v2";

        this.config = {
            headers: {"X-Api-Key": this.apiKey} // request headers
        };
    }

    /**
     * Returns the list of alert policies for this account
     */
    async getAlertPolicies() {
        let currentPage = 1;
        let alertPolicies = {};
        let hadResponse;

        // Iterate over the alert policy pages and collect all policies into an object to return
        do {
            try {
                const url = this.NR_API_URL + "/alerts_policies.json?page=" + currentPage;
                const response = await axios.get(url, this.config);

                if (response.data.policies.length > 0) {
                    let policies = response.data.policies;

                    // parsed response body as js object
                    for (let i = 0; i < policies.length; i++) {
                        const policy = policies[i];
                        const policy_name = policy.name.toLowerCase();
                        alertPolicies[policy_name] = policy;
                    }

                    // Try the next page
                    currentPage++;
                    hadResponse = true;
                }
                else {
                    hadResponse = false;
                }
            } catch (error) {
                console.error(error);
            }
        } while (hadResponse);

        return alertPolicies;
    }
}

module.exports = NewRelicClient;
