const LogStatuspageControllerPlugin = function () {

    this.hookStatusChange = function (component, status, violation) {
        console.log('Logging status change', component.name, status);
    }

};

module.exports = LogStatuspageControllerPlugin;
