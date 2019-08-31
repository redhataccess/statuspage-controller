'use strict';

const axios = require('axios');

/**
 * Stateless New Relic rest client
 */
class StatusPageClient {
    constructor(pageId, apiKey) {
        this.SP_API_URL = "https://api.statuspage.io/v1/pages/" + pageId;
        this.SP_API_KEY = apiKey;
        this.config = {
            headers: {
                "Authorization": "OAuth " + this.SP_API_KEY,
                "Content-Type": "application/x-www-form-urlencoded"
            }
        };
    }

    /**
     * Returns true if the client can talk to Status Page API
     * @returns {boolean}
     */
    async checkStatusPageAPI() {
        const url = this.SP_API_URL + "/components.json";

        try {
            await axios.get(url, this.config);
            console.log('[SP Client] Status Page API health check successful');
            return true;
        } catch (e) {
            console.error('[SP Client] Status Page API check failed, response code:', e.response.status, e.response.statusText);
            return false
        }
    }

    /**
     * Returns a list of all the components on the status page flattened by component group
     * @returns {Object} List of components
     */
    async getFlattenedStatusPageComponents() {
        let flattenedComponents = {};
        let componentGroupNames = {};

        try {
            console.log('[SP Client] getFlattenedStatusPageComponents');

            const url = this.SP_API_URL + "/components.json";
            const response = await axios.get(url, this.config);

            if (response.status === 200) {
                const data = response.data;

                console.log("[SP Client] Statuspage.io components: ", data.length);

                for (let i = 0; i < data.length; i++) {
                    const component = data[i];

                    // Save all group names into a lookup table
                    if (component.group) {
                        componentGroupNames[component.id] = component.name;
                    }
                }

                // Now flatten components if they are in a group by prefixing with group name
                for (let i = 0; i < data.length; i++) {
                    const component = data[i];
                    const componentName = component.name.toLowerCase();

                    if (!component.group) {
                        if (component.group_id) {
                            let flatName = componentGroupNames[component.group_id] + '-' + componentName;
                            flattenedComponents[flatName] = component;
                        } else {
                            flattenedComponents[componentName] = component;
                        }
                    }
                }
            }
            else {
                //TODO: Can remove this
                console.log("[SP Client] Invalid response from statuspage.io API. Status code: " + response.status);
            }
        } catch (error) {
            console.error('[SP Client] error', error);
        }

        return flattenedComponents;
    }

    async updateComponentStatus(component, status) {
        if (component && component.name && status) {
            const patchData = "component[status]=" + status;
            let url = this.SP_API_URL + "/components/" + component.id + ".json";

            const response = await axios.patch(url, patchData, this.config);

            if (response.status === 200) {
                console.log("[SP Client] Status updated successfully for component: ", component.name, status);
            }
            else {
                //TODO: Replace this with try/catch block
                console.error("[SP Client] Error updating status for component: ", component.name, status, response.status);
            }
        }
    }
}

module.exports = StatusPageClient;
