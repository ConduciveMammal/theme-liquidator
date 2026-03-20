import test from 'node:test';
import assert from 'node:assert/strict';
import {getBrokerApiBaseUrl, isBrokerConfigured} from '../src/broker-client.js';

test('getBrokerApiBaseUrl prefers the environment value', () => {
	const authConfig = {
		credentials: {
			apiBaseUrl: 'https://config.example.com'
		}
	};
	const shopProfile = {
		apiBaseUrl: 'https://shop.example.com'
	};

	assert.equal(
		getBrokerApiBaseUrl(
			{
				SHOPIFY_LIQUIDATOR_API_BASE_URL: 'https://env.example.com/'
			},
			authConfig,
			shopProfile
		),
		'https://env.example.com'
	);
});

test('isBrokerConfigured falls back to stored shop and global config values', () => {
	assert.equal(
		isBrokerConfigured(
			{},
			{
				credentials: {
					apiBaseUrl: 'https://config.example.com'
				}
			}
		),
		true
	);

	assert.equal(
		isBrokerConfigured(
			{},
			{
				credentials: {
					apiBaseUrl: ''
				}
			},
			{
				apiBaseUrl: 'https://shop.example.com'
			}
		),
		true
	);
});
