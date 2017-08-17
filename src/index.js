import fs from 'fs';
// const FritzBoxAPI = require('fritz-box');
import FritzBoxAPI from '../../fritz-box';

import _ from 'lodash';
import Moment from 'moment-timezone';
import request from 'request';

import feathers from 'feathers/client';
import rest from 'feathers-rest/client';

import config from '../config.json';

import Debug from 'debug-levels';
const debug = Debug('fritz-logger')

const client = feathers();
const restClient = rest(config.feathers.url);

client.configure(restClient.request(request));
const metrics = client.service('metrics');

const box = new FritzBoxAPI(config.fritzbox);

const run = async () => {
    debug.log('Running...');

    try {
        await box.getSession();
    } catch (e) {
        debug.error(e);
    }

    let lastClients;
    let lastDatapoint;

    setInterval(async () => {
        try {
            const now = Moment().tz(config.timezone).format();
            const connectedClients = await box.getConnectedClients();

            // Get client details, use MAC as id
            const clients = await Promise.all(connectedClients.map(async (client) => {
                const { mac, name } = await box.getClientDetails(client.id)
                return { id: mac, name };
            }));

            debug.info(clients);

            if (_.isEqual(lastClients, clients)) {
                metrics.patch(lastDatapoint._id, { timestampEnd: now });
            } else {
                lastClients = clients;

                const datapoint = {
                    timestamp: now,
                    sensorId: 'fritzbox-router',
                    type: 'wlan-clients',
                    clients
                };

                lastDatapoint = await metrics.create(datapoint);
                debug.info(lastDatapoint);
            }
        } catch (e) {
            debug.error(e);

            // Reauthenticate if session dead
            if (e.status == 403) {
                await box.getSession();
            }
        }
    }, config.loggingInterval * 1000);
}

run();
