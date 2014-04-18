var Promise = require('bluebird');
var request = Promise.promisify(require('request'));
var EventEmitter = require('events').EventEmitter;
var util = require('util');
var _ = require('lodash');

var SpectatorClient = function (platformId, credentials) {
    this.gameId = credentials.gameId;
    this.platformId = platformId;
    this.baseURL = 'http://' + credentials.gameServerAddress + ':' + credentials.observerServerPort + '/observer-mode/rest/consumer';
    this.chunk_id = 0;
    this.keyFrame_id = 0;
    this.chunks = [];
    this.keyFrames = [];
};

util.inherits(SpectatorClient, EventEmitter);

SpectatorClient.prototype.version = function () {
    var self = this;

    return request(self.baseURL + '/version').spread(function (response, body) {
        self.emit('version', body);

        return body;
    });
};

SpectatorClient.prototype.getGameMetaData = function () {
    var self = this;

    return request(self.baseURL + '/getGameMetaData/' + self.platformId + '/' + self.gameId + '/0/token').spread(function (response, body) {
        var data = JSON.parse(body);
        self.emit('metadata', data);

        return data;
    });
};

SpectatorClient.prototype.getLastChunkInfo = function () {
    var self = this;

    return request(
        self.baseURL + '/getLastChunkInfo/' + self.platformId + '/' + self.gameId + '/30000/token'
    ).spread(function (response, body) {
        var data = JSON.parse(body);
        self.emit('chunkinfo', data);

        return data;
    });
};

SpectatorClient.prototype.getGameDataChunk = function (chunkId) {
    var self = this;

    return request({
        url: self.baseURL + '/getGameDataChunk/' + self.platformId + '/' + self.gameId + '/' + chunkId + '/token',
        encoding: null
    }).spread(function (response, body) {
        if (response.statusCode !== 200) throw new Error('Chunk not available on server for gameKey: GameKey:' + self.gameId + ';' + self.platformId + ' chunkId: ' + chunkId);

        self.emit('chunk', { chunkId: chunkId, data: body });

        return chunkId;
    });
};

SpectatorClient.prototype.getKeyFrame = function (keyFrameId) {
    var self = this;
    
    return request({
        url: self.baseURL + '/getKeyFrame/' + self.platformId + '/' + self.gameId + '/' + keyFrameId + '/token',
        encoding: null
    }).spread(function (response, body) {
        if (response.statusCode !== 200) throw new Error('KeyFrame not available on server for gameKey: GameKey:' + self.gameId + ';' + self.platformId + ' keyFrameId: ' + keyFrameId);

        self.emit('keyframe', { keyFrameId: keyFrameId, data: body });

        return keyFrameId;
    });
};

SpectatorClient.prototype.endOfGameStats = function () {
    var self = this;

    return request({
        url: self.baseURL + '/endOfGameStats/' + self.platformId + '/' + self.gameId + '/token',
        encoding: null
    }).spread(function (response, body) {
        self.emit('endofgamestats', body);

        return body;
    });
};

// what the fuck is this ???
SpectatorClient.prototype.messages = function (fn) {

};

SpectatorClient.prototype.init = function () {
    
    return this.getGameMetaData().bind(this)
    .then(this.update)
    .then(function () {       
        this.emit('end');
    }).catch(function (error) {
        this.emit('error', error);

        throw error;
    });
};

SpectatorClient.prototype.update = function () {
    var self = this;

    return self.getLastChunkInfo().then(function (lastChunkInfo) {
        var chunkIds = [];
        var keyFrameIds = [];

        for (var i = 1; i <= lastChunkInfo.chunkId; i++) {
            if (self.chunks[i] !== true) chunkIds.push(i);
        }

        for (var j = 1; j <= lastChunkInfo.keyFrameId; j++) {
            if (self.keyFrames[j] !== true) keyFrameIds.push(j);
        }

        self.chunk_id = i - 1;
        self.keyFrame_id = j - 1;

        var chunkP = Promise.settle(_.map(chunkIds, function (chunkId) {
            return self.getGameDataChunk(chunkId).then(function () {
                self.chunks[chunkId] = true;
            });
        }));

        var keyFrameP = Promise.settle(_.map(keyFrameIds, function (keyFrameId) {
            return self.getKeyFrame(keyFrameId).then(function () {
                self.keyFrames[keyFrameId] = true;
            });
        }));

        return Promise.settle([chunkP, keyFrameP]).then(function () {
            
            if (lastChunkInfo.nextAvailableChunk == 0
                || lastChunkInfo.endGameChunkId > 0 && self.chunk_id == lastChunkInfo.endGameChunkId) {

                return Promise.join(self.endOfGameStats(), self.getGameMetaData());
            }

            var delay = lastChunkInfo.nextAvailableChunk < 1 ? 10000 : lastChunkInfo.nextAvailableChunk;

            return Promise.delay(delay).bind(self).then(self.update);
        });
    });
};

module.exports = SpectatorClient;
