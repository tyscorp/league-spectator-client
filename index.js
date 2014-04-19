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
    return request(
        this.baseURL + '/version'
    ).spread(function (response, body) {
        this.emit('version', body);

        return body;
    }.bind(this));
};

SpectatorClient.prototype.getGameMetaData = function () {
    return request(
        this.baseURL + '/getGameMetaData/' + this.platformId + '/' + this.gameId + '/0/token'
    ).spread(function (response, body) {
        if (response.statusCode !== 200) {
            var error = new Error('No Game found for provided gameKey in Store. GameKey:' + this.gameId + ';' + this.platformId + ' chunkId: ' + chunkId);
            this.emit('error', error);

            throw error;
        }

        var data = JSON.parse(body);
        this.emit('gameMetaData', data);

        return data;
    }.bind(this));
};

SpectatorClient.prototype.getLastChunkInfo = function () {
    return request(
        this.baseURL + '/getLastChunkInfo/' + this.platformId + '/' + this.gameId + '/30000/token'
    ).spread(function (response, body) {
        if (response.statusCode !== 200) {
            var error = new Error('No Game found for provided gameKey in Store. GameKey:' + this.gameId + ';' + this.platformId + ' chunkId: ' + chunkId);
            this.emit('error', error);

            throw error;
        }

        var data = JSON.parse(body);
        this.emit('lastChunkInfo', data);

        return data;
    }.bind(this));
};

SpectatorClient.prototype.getGameDataChunk = function (chunkId) {
    return request({
        url: this.baseURL + '/getGameDataChunk/' + this.platformId + '/' + this.gameId + '/' + chunkId + '/token',
        encoding: null
    }).spread(function (response, body) {
        if (response.statusCode !== 200) {
            var error = new Error('Chunk not available on server for gameKey: GameKey:' + this.gameId + ';' + this.platformId + ' chunkId: ' + chunkId);
            this.emit('error', error);

            throw error;
        }

        this.emit('chunk', chunkId, body);

        return chunkId;
    }.bind(this));
};

SpectatorClient.prototype.getKeyFrame = function (keyFrameId) {
    return request({
        url: this.baseURL + '/getKeyFrame/' + this.platformId + '/' + this.gameId + '/' + keyFrameId + '/token',
        encoding: null
    }).spread(function (response, body) {
        if (response.statusCode !== 200) {
            var error = new Error('KeyFrame not available on server for gameKey: GameKey:' + this.gameId + ';' + this.platformId + ' chunkId: ' + chunkId);
            this.emit('error', error);

            throw error;
        }

        this.emit('keyFrame', keyFrameId, body);

        return keyFrameId;
    }.bind(this));
};

SpectatorClient.prototype.endOfGameStats = function () {
    return request({
        url: this.baseURL + '/endOfGameStats/' + this.platformId + '/' + this.gameId + '/token',
        encoding: null
    }).spread(function (response, body) {
        if (response.statusCode !== 200) {
            var error = new Error('No Game stats found for provided gameKey in Store. GameKey:' + this.gameId + ';' + this.platformId + ' chunkId: ' + chunkId);
            this.emit('error', error);

            throw error;
        }

        this.emit('endOfGameStats', body);

        return body;
    }.bind(this));
};

SpectatorClient.prototype.init = function () { 
    return this.version().bind(this)
    .then(this.getGameMetaData)
    .then(this.update)
    .then(function () {       
        this.emit('end');
    }).catch(function (error) {
        this.emit('error', error);

        throw error;
    });
};

SpectatorClient.prototype.update = function () {
    return this.getLastChunkInfo().bind(this).then(function (lastChunkInfo) {
        var now = Date.now();

        var chunkIds = [];
        var keyFrameIds = [];

        for (var i = 1; i <= lastChunkInfo.chunkId; i++) {
            if (this.chunks[i] !== true) chunkIds.push(i);
        }

        for (var j = 1; j <= lastChunkInfo.keyFrameId; j++) {
            if (this.keyFrames[j] !== true) keyFrameIds.push(j);
        }

        this.chunk_id = i - 1;
        this.keyFrame_id = j - 1;

        var chunkP = Promise.settle(_.map(chunkIds, function (chunkId) {
            return this.getGameDataChunk(chunkId).then(function () {
                this.chunks[chunkId] = true;
            });
        }));

        var keyFrameP = Promise.settle(_.map(keyFrameIds, function (keyFrameId) {
            return this.getKeyFrame(keyFrameId).then(function () {
                this.keyFrames[keyFrameId] = true;
            });
        }));

        // we don't care about the result, just that they're done
        return Promise.settle([chunkP, keyFrameP]); 
    }).then(function () {
        // check to see if we've finished
        if (lastChunkInfo.nextAvailableChunk == 0
            || lastChunkInfo.endGameChunkId > 0 && this.chunk_id == lastChunkInfo.endGameChunkId) {

            return Promise.join(this.endOfGameStats(), this.getGameMetaData());
        }

        var delay = lastChunkInfo.nextAvailableChunk < 1
            ? 10000
            : lastChunkInfo.nextAvailableChunk - (Date.now() - now);

        return Promise.delay(delay).bind(this).then(this.update);
    });
};

module.exports = SpectatorClient;
