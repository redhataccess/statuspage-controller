var LogStatuspageControllerPlugin = function () {

    this.hookStatusChange = function (component, status, violation) {
        console.log('Logging status change', component.name, status, violation.policy_name);
    }

};

module.exports = LogStatuspageControllerPlugin;
