import Debug from 'debug-levels';
const debug = Debug('fritz-logger');

import fs from 'fs';
// const FritzBoxAPI = require('fritz-box');
import FritzBoxAPI from '../../fritz-box';

import _ from 'lodash';
import Moment from 'moment-timezone';
import request from 'request';

import feathers from 'feathers/client';
import rest from 'feathers-rest/client';

import config from '../config.json';

const client = feathers();
const restClient = rest(config.feathers.url);

client.configure(restClient.request(request));
const metrics = client.service('metrics');

const box = new FritzBoxAPI(config.fritzbox);

const run = async () => {
    try {
        debug.log('Requesting fritzbox session');
        await box.getSession();
        debug.log('Received session');
    } catch (e) {
        debug.error(e);
    }

    const clientDatapointId = new Map();
    let newClients, knownClients, lastKnownClients = [];

    setInterval(async () => {
        try {
            debug.verbose('Getting connected clients');
            const connectedClients = await box.getConnectedClients();
            debug.verbose(`Connected clients: ${connectedClients.length}. Fetching details`);

            const now = Moment().tz(config.timezone).format();

            // Get client details, use MAC as id
            const clients = await Promise.all(connectedClients.map(async (client) => {
                const { mac, name } = await box.getClientDetails(client.id)
                return { id: mac, name };
            }));

            newClients = _.differenceBy(clients, lastKnownClients, 'id');
            newClients.length && debug.log(`New clients: ${newClients.length}. Creating datapoints`);

            newClients.forEach(async ({ id, name }) => {
                const datapoint = {
                    timestamp: now,
                    sensorId: 'fritzbox-router',
                    type: 'wlan-client',
                    client: { id, name }
                };

                const { _id: datapointId } = await metrics.create(datapoint);
                clientDatapointId.set(id, datapointId);
            });

            knownClients = _.intersectionBy(clients, lastKnownClients, 'id');
            knownClients.length && debug.log(`Previously known clients: ${knownClients.length}. Updating datapoints`);

            knownClients.forEach(({ id, name }) => {
                metrics.patch(clientDatapointId.get(id), { timestampEnd: now });
            });

            lastKnownClients = clients;
        } catch (e) {
            debug.error(e);

            // Reauthenticate if session is dead
            if (e.status == 403) {
                await box.getSession();
            }
        }
    }, config.loggingInterval * 1000);
}

run();
