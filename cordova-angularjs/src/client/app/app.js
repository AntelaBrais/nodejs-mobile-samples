/* global nodejs, io */

angular
.module("example.nodejsmobile.app", ["ui.bootstrap"])

.factory('theSocket', ['$q', function ($q) {
  "use strict";

  function getSocket(url) {
      url = url || 'http://localhost:8081';
      return io(url, { reconnection: true });
  }

  var theInstance,
      foregroundDeferred,
      pendingInstanceDeferred;

  // Application has just started, it's in foreground
  foregroundDeferred = $q.defer();
  foregroundDeferred.resolve();

  function waitForForeground() {
      if (!foregroundDeferred) {
          foregroundDeferred = $q.defer();
      }
      return foregroundDeferred.promise;
  }

  function getInstance() {
      return waitForForeground().then(function () {
          if (theInstance) {
              // We already have a valid socket instance.
              return $q.resolve(theInstance);
          } else if (!theInstance && !pendingInstanceDeferred) {
              // No instance and no pending instance
              pendingInstanceDeferred = $q.defer();

              // There is no connected socket.  It needs to be reestablished.
              var pendingInstance = getSocket();

              pendingInstance.on('connect', function () {
                  console.log('Socket connection established.');
                  theInstance     = pendingInstance;
                  pendingInstance = undefined;
                  pendingInstanceDeferred.resolve(theInstance);
                  pendingInstanceDeferred = undefined;
              });

              return pendingInstanceDeferred.promise;
          } else {
              // Just give the caller back the promise that we returned previously.
              return pendingInstanceDeferred.promise;
          }
      });
  }

  function destroy() {
      if (theInstance) {
          theInstance.off(); // remove all listeners for this socket
          theInstance.disconnect();
          theInstance = undefined;
          pendingInstanceDeferred = undefined;
      }
  }

  return {
      getInstance: getInstance,
      destroy: destroy
  };
}])
.run([ '$rootScope', '$http', '$timeout', 'theSocket',
function($rootScope, $http, $timeout, theSocket) {
    'use strict';

    $rootScope.title = 'NodeJS Mobile Test';
    $rootScope.debugMessages = [];

    var counter = 0;
    function appendToLog(msg, forceDigest) {
        console.log(msg);
        counter++;
        $rootScope.debugMessages.push(counter + ': ' + msg);
        if(forceDigest) {
            // Force angular scope update when out of scope, so the messages will appear as soon as possible.
            // Mostly used for callback environments, since it will cause an error if there's a digest already in progress.
            $rootScope.$digest();
        }
    }
    function clearLog() {
        console.log("Log was cleared.");
        counter = 0;
        $rootScope.debugMessages = [];
    }

    var app = {
        // Application Constructor
        initialize: function() {
            // Bind any cordova events here. Common events are:
            // 'deviceready', pause', 'resume', etc.
            document.addEventListener('deviceready', this.onDeviceReady.bind(this), false);
            document.addEventListener('pause', this.onDevicePause.bind(this), false);
            document.addEventListener('resume', this.onDeviceResume.bind(this), false);

            if (!(window && window.cordova)) { // browser dev
                $timeout(checkHttp, 2000);
            }
        },

        onDeviceReady: function() {
            this.receivedEvent('deviceready');
            startNodeProject();
        },

        onDevicePause: function() {
            this.receivedEvent('pause');
            stopSocket();
            theSocket.destroy();
        },

        onDeviceResume: function() {
            this.receivedEvent('resume');
            checkHttp();
        },

        receivedEvent: function(id) {
            appendToLog('AngularJS Received Event: ' + id, true);
        }
    };

    app.initialize();

    function channelListener(msg) {
        appendToLog('[AngularJS Cordova] received: ' + msg, true);
    }

    function startNodeProject() {
        nodejs.channel.setListener(channelListener);

        nodejs.channel.on('angular-log', (msg) => {
            // For receiving log requests from node.
            appendToLog("node-log: " + msg, true);
        });

        nodejs.channel.on('started', (msg) => {
            appendToLog("Node sent the 'started' event, with this message: " + msg, true);
            checkHttp();
        });

        nodejs.start('main.js',
        function(err) {
            if (err) {
                appendToLog('AngularJS, failed NodeJs engine' + err, true);
            } else {
                appendToLog('AngularJS, started NodeJs engine', true);
            }
        });
    }

    function checkHttp() {
        appendToLog('[AngularJS Cordova] checking HTTP API');
        $http.get('http://localhost:8081')
        .then(function(response) {
            $rootScope.message = JSON.stringify(response.data);
            appendToLog('HTTP response: ' + JSON.stringify(response.data));
        })
        .catch(function(err) {
            $rootScope.message = 'HTTP err:' + JSON.stringify(err);
            appendToLog('HTTP err: ' + JSON.stringify(err), true);
        });
    }

    function startSocket() {
        appendToLog('[AngularJS Cordova] starting socket via API');
        theSocket.getInstance()
        .then(function (socket) {
            socket.on('data_update', function(data) {
                appendToLog('AngularJS got socket data: ' + data, true);
            });
            socket.emit('start_data_updates', {});
        }).catch(function(err) {
            appendToLog('AngularJS Socket Error: ' + err, true);
        });
    }

    function stopSocket() {
        appendToLog('[AngularJS Cordova] stopping socket via API');
        theSocket.getInstance()
        .then(function (socket) {
            socket.emit('stop_data_updates', {});
            socket.off();
        }).catch(function(err) {
            appendToLog('AngularJS Socket Error: ' + err, true);
        });
    }

    function doFileWrite() {
        nodejs.channel.removeAllListeners('test-file-saved');
        var randomData=Math.random().toString(36).substring(7);
        appendToLog('Will tell nodejs to write this to a file: '+ randomData);
        nodejs.channel.on('test-file-saved', (msg) => {
            appendToLog('nodejs says it saved data in :' + msg, true);

            window.resolveLocalFileSystemURL('file://' + msg,
                function(fileEntry) {

                    fileEntry.file( (file) => {
                        var reader = new FileReader();
                        reader.onloadend = function() {
                            appendToLog('Read ' + this.result + ' Expected ' + randomData, true);
                        };
                        reader.readAsText(file);
                    });

                }
                , function(error) {
                    appendToLog('Error while getting ' + msg + ' -> ' + JSON.stringify(error), true);
                }
            );
        });
        nodejs.channel.post('test-file', randomData);
    }

    function sendEcho() {
        // Sends echo request to nodeJS.
        nodejs.channel.post('node-echo', 'Hello from AngularJS Cordova!');
    }

    function toggleEcho() {
        // Toggles echo on and off on the nodeJS side.
        nodejs.channel.post('control', {
            action: 'toggle-event-listeners',
            eventName: 'node-echo'
        });
    }

    let additionalEchoListeners = [];
    let createdListenerCount = 1;

    function addAnotherEchoListener() {
        // Adds another listener to message events and saves it for later removal.
        let newListener = ( function() {
            let thisListenerId = createdListenerCount++;
            return (msg) => { appendToLog('Another ' + thisListenerId + ' : ' + msg, true); };
        })();
        nodejs.channel.on('message', newListener);
        additionalEchoListeners.push(newListener);
        appendToLog('Another listener has been added. Test it with Echo.');
    }

    function removeAnotherEchoListener() {
        // Removes one of the "another" listeners from the message events.
        let listenerToRemove = additionalEchoListeners.shift();
        if (typeof listenerToRemove === "undefined") {
            appendToLog('No more listeners to remove.');
        } else {
            nodejs.channel.removeListener('message', listenerToRemove);
            appendToLog('Removed another listener.');
        }
    }

    function loadAllDependencies() {
        // Instructs node to require all dependencies
        nodejs.channel.post('control', {
            action: 'load-all-dependencies'
        });
    }

    $rootScope.doHttp  = checkHttp;
    $rootScope.doStart = startSocket;
    $rootScope.doStop  = stopSocket;
    $rootScope.clearLog = clearLog;
    $rootScope.sendEcho = sendEcho;
    $rootScope.toggleEcho = toggleEcho;
    $rootScope.doFileWrite = doFileWrite;
    $rootScope.addAnotherEchoListener = addAnotherEchoListener;
    $rootScope.removeAnotherEchoListener = removeAnotherEchoListener;
    $rootScope.loadAllDependencies = loadAllDependencies;
}
]);
