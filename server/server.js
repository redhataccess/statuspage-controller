#!/bin/env node
//  Sample Node.js WebSocket Client-Server application
var http            = require('http');
var express         = require('express');
var WebSocketServer = require('ws').Server;

// Patch console.x methods in order to add timestamp information
require("console-stamp")(console, {pattern: "mm/dd/yyyy HH:MM:ss.l"});

/**
 *  Define the sample server.
 */
var MainServer = function () {

    //  Scope.
    var self = this;


    /*  ================================================================  */
    /*  Helper functions.                                                 */
    /*  ================================================================  */

    /**
     *  Set up server env variables/defaults.
     */
    self.setupVariables = function () {
        //  Set the environment variables we need.
        self.port = process.env.PORT || 3000;
    };


    /**
     *  terminator === the termination handler
     *  Terminate server on receipt of the specified signal.
     */
    self.terminator = function (sig) {
        if (typeof sig === "string") {
            console.log('Received %s - terminating sample server ...', sig);
            process.exit(1);
        }
        console.log('Node server stopped.');
    };


    /**
     *  Setup termination handlers (for exit and a list of signals).
     */
    self.setupTerminationHandlers = function () {
        //  Process on exit and signals.
        process.on('exit', function() { self.terminator(0); });

        ['SIGHUP', 'SIGINT', 'SIGQUIT', 'SIGILL', 'SIGTRAP', 'SIGABRT',
         'SIGBUS', 'SIGFPE', 'SIGUSR1', 'SIGSEGV', 'SIGUSR2', 'SIGTERM'
        ].forEach(function(element) {
            process.on(element, function() { self.terminator(element); });
        });
    };


    /*  ================================================================  */
    /*  App server functions (main app logic here).                       */
    /*  ================================================================  */

    /**
     *  Create the routing table entries + handlers for the application.
     */
    self.createRoutes = function () {
        self.routes = {};

        self.routes['/api/example'] = function (req, res) {
            res.setHeader('Content-Type', 'application/json');
            res.send("{}");
        };
    };


    /**
     *  Initialize the server (express) and create the routes and register
     *  the handlers.
     */
    self.initializeServer = function () {
        self.createRoutes();
        self.app = express();
        self.httpServer = http.Server(self.app);

        // Set up WebSocket Server
        self.wss = new WebSocketServer({server: self.httpServer});
        self.wss.broadcast = function broadcast(data) {
            self.wss.clients.forEach(function each(client) {
                client.send(data);
            });
        };

        var updateCount = 0;

        setInterval(function() {
            // send to all clients
            self.wss.broadcast(JSON.stringify(++updateCount));
        }, 100);

        self.wss.on('connection', function (ws) {

            console.log('started client interval');

            ws.on('message', function (msg, flags) {
                if (flags.binary) {
                    var ab = toArrayBuffer(msg);
                    var arr = new Int32Array(ab);
                    console.log(arr[0]);
                }
                else {
                    console.log(msg);
                }
            });

            ws.on('close', function () {
                console.log('Client connection closed');
            });

            function toArrayBuffer(buffer) {
                var ab = new ArrayBuffer(buffer.length);
                var view = new Uint8Array(ab);
                for (var i = 0; i < buffer.length; ++i) {
                    view[i] = buffer[i];
                }
                return ab;
            }
        });

        // Set up express static content root
        self.app.use(express.static(__dirname + '/../' + (process.argv[2] || 'client')));

        //  Add handlers for the app (from the routes).
        for (var r in self.routes) {
            if (self.routes.hasOwnProperty(r)) {
                self.app.get(r, self.routes[r]);
            }
        }
    };


    /**
     *  Initializes the server
     */
    self.initialize = function () {
        self.setupVariables();
        self.setupTerminationHandlers();

        // Create the express server and routes.
        self.initializeServer();
    };


    /**
     *  Start the server
     */
    self.start = function () {
        //  Start the app on the specific interface (and port).
        self.httpServer.listen(self.port, function () {
            console.log('Node server started on localhost:%d ...', self.port);
        });
    };
};


/**
 *  main():  Main code.
 */
var mainServer = new MainServer();
mainServer.initialize();
mainServer.start();

