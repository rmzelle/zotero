"use strict";

describe("Zotero.Sync.Data.Engine", function () {
	Components.utils.import("resource://zotero/config.js");
	
	var apiKey = Zotero.Utilities.randomString(24);
	var baseURL = "http://local.zotero/";
	var engine, server, client, caller, stub, spy;
	
	var responses = {};
	
	var setup = Zotero.Promise.coroutine(function* (options = {}) {
		server = sinon.fakeServer.create();
		server.autoRespond = true;
		
		Components.utils.import("resource://zotero/concurrentCaller.js");
		var caller = new ConcurrentCaller(1);
		caller.setLogger(msg => Zotero.debug(msg));
		caller.stopOnError = true;
		
		var client = new Zotero.Sync.APIClient({
			baseURL,
			apiVersion: options.apiVersion || ZOTERO_CONFIG.API_VERSION,
			apiKey,
			caller,
			background: options.background || true
		});
		
		var engine = new Zotero.Sync.Data.Engine({
			apiClient: client,
			libraryID: options.libraryID || Zotero.Libraries.userLibraryID,
			stopOnError: true
		});
		
		return { engine, client, caller };
	});
	
	function setResponse(response) {
		setHTTPResponse(server, baseURL, response, responses);
	}
	
	function makeCollectionJSON(options) {
		return {
			key: options.key,
			version: options.version,
			data: {
				key: options.key,
				version: options.version,
				name: options.name,
				parentCollection: options.parentCollection
			}
		};
	}
	
	function makeSearchJSON(options) {
		return {
			key: options.key,
			version: options.version,
			data: {
				key: options.key,
				version: options.version,
				name: options.name,
				conditions: options.conditions ? options.conditions : [
					{
						condition: 'title',
						operator: 'contains',
						value: 'test'
					}
				]
			}
		};
	}
	
	function makeItemJSON(options) {
		var json = {
			key: options.key,
			version: options.version,
			data: {
				key: options.key,
				version: options.version,
				itemType: options.itemType || 'book',
				title: options.title || options.name
			}
		};
		Object.assign(json.data, options);
		delete json.data.name;
		return json;
	}
	
	// Allow functions to be called programmatically
	var makeJSONFunctions = {
		collection: makeCollectionJSON,
		search: makeSearchJSON,
		item: makeItemJSON
	};
	
	var assertInCache = Zotero.Promise.coroutine(function* (obj) {
		var cacheObject = yield Zotero.Sync.Data.Local.getCacheObject(
			obj.objectType, obj.libraryID, obj.key, obj.version
		);
		assert.isObject(cacheObject);
		assert.propertyVal(cacheObject, 'key', obj.key);
	});
	
	var assertNotInCache = Zotero.Promise.coroutine(function* (obj) {
		assert.isFalse(yield Zotero.Sync.Data.Local.getCacheObject(
			obj.objectType, obj.libraryID, obj.key, obj.version
		));
	});
	
	//
	// Tests
	//
	beforeEach(function* () {
		yield resetDB({
			thisArg: this,
			skipBundledFiles: true
		});
		
		Zotero.HTTP.mock = sinon.FakeXMLHttpRequest;
		
		yield Zotero.Users.setCurrentUserID(1);
		yield Zotero.Users.setCurrentUsername("testuser");
	})
	
	after(function () {
		Zotero.HTTP.mock = null;
	});
	
	describe("Syncing", function () {
		it("should download items into a new library", function* () {
			({ engine, client, caller } = yield setup());
			
			var headers = {
				"Last-Modified-Version": 3
			};
			setResponse({
				method: "GET",
				url: "users/1/settings",
				status: 200,
				headers: headers,
				json: {
					tagColors: {
						value: [
							{
								name: "A",
								color: "#CC66CC"
							}
						],
						version: 2
					}
				}
			});
			setResponse({
				method: "GET",
				url: "users/1/collections?format=versions",
				status: 200,
				headers: headers,
				json: {
					"AAAAAAAA": 1
				}
			});
			setResponse({
				method: "GET",
				url: "users/1/searches?format=versions",
				status: 200,
				headers: headers,
				json: {
					"AAAAAAAA": 2
				}
			});
			setResponse({
				method: "GET",
				url: "users/1/items/top?format=versions&includeTrashed=1",
				status: 200,
				headers: headers,
				json: {
					"AAAAAAAA": 3
				}
			});
			setResponse({
				method: "GET",
				url: "users/1/items?format=versions&includeTrashed=1",
				status: 200,
				headers: headers,
				json: {
					"AAAAAAAA": 3,
					"BBBBBBBB": 3
				}
			});
			setResponse({
				method: "GET",
				url: "users/1/collections?format=json&collectionKey=AAAAAAAA",
				status: 200,
				headers: headers,
				json: [
					makeCollectionJSON({
						key: "AAAAAAAA",
						version: 1,
						name: "A"
					})
				]
			});
			setResponse({
				method: "GET",
				url: "users/1/searches?format=json&searchKey=AAAAAAAA",
				status: 200,
				headers: headers,
				json: [
					makeSearchJSON({
						key: "AAAAAAAA",
						version: 2,
						name: "A"
					})
				]
			});
			setResponse({
				method: "GET",
				url: "users/1/items?format=json&itemKey=AAAAAAAA&includeTrashed=1",
				status: 200,
				headers: headers,
				json: [
					makeItemJSON({
						key: "AAAAAAAA",
						version: 3,
						itemType: "book",
						title: "A"
					})
				]
			});
			setResponse({
				method: "GET",
				url: "users/1/items?format=json&itemKey=BBBBBBBB&includeTrashed=1",
				status: 200,
				headers: headers,
				json: [
					makeItemJSON({
						key: "BBBBBBBB",
						version: 3,
						itemType: "note",
						parentItem: "AAAAAAAA",
						note: "This is a note."
					})
				]
			});
			setResponse({
				method: "GET",
				url: "users/1/deleted?since=0",
				status: 200,
				headers: headers,
				json: {}
			});
			yield engine.start();
			
			var userLibraryID = Zotero.Libraries.userLibraryID;
			
			// Check local library version
			assert.equal(Zotero.Libraries.getVersion(userLibraryID), 3);
			
			// Make sure local objects exist
			var setting = Zotero.SyncedSettings.get(userLibraryID, "tagColors");
			assert.lengthOf(setting, 1);
			assert.equal(setting[0].name, 'A');
			var settingMetadata = Zotero.SyncedSettings.getMetadata(userLibraryID, "tagColors");
			assert.equal(settingMetadata.version, 2);
			assert.isTrue(settingMetadata.synced);
			
			var obj = yield Zotero.Collections.getByLibraryAndKeyAsync(userLibraryID, "AAAAAAAA");
			assert.equal(obj.name, 'A');
			assert.equal(obj.version, 1);
			assert.isTrue(obj.synced);
			yield assertInCache(obj);
			
			obj = yield Zotero.Searches.getByLibraryAndKeyAsync(userLibraryID, "AAAAAAAA");
			assert.equal(obj.name, 'A');
			assert.equal(obj.version, 2);
			assert.isTrue(obj.synced);
			yield assertInCache(obj);
			
			obj = yield Zotero.Items.getByLibraryAndKeyAsync(userLibraryID, "AAAAAAAA");
			assert.equal(obj.getField('title'), 'A');
			assert.equal(obj.version, 3);
			assert.isTrue(obj.synced);
			var parentItemID = obj.id;
			yield assertInCache(obj);
			
			obj = yield Zotero.Items.getByLibraryAndKeyAsync(userLibraryID, "BBBBBBBB");
			assert.equal(obj.getNote(), 'This is a note.');
			assert.equal(obj.parentItemID, parentItemID);
			assert.equal(obj.version, 3);
			assert.isTrue(obj.synced);
			yield assertInCache(obj);
		})
		
		it("should download items into a new read-only group", function* () {
			var group = yield createGroup({
				editable: false,
				filesEditable: false
			});
			var libraryID = group.libraryID;
			var itemToDelete = yield createDataObject(
				'item', { libraryID, synced: true }, { skipEditCheck: true }
			)
			var itemToDeleteID = itemToDelete.id;
			
			({ engine, client, caller } = yield setup({ libraryID }));
			
			var headers = {
				"Last-Modified-Version": 3
			};
			setResponse({
				method: "GET",
				url: `groups/${group.id}/settings`,
				status: 200,
				headers: headers,
				json: {
					tagColors: {
						value: [
							{
								name: "A",
								color: "#CC66CC"
							}
						],
						version: 2
					}
				}
			});
			setResponse({
				method: "GET",
				url: `groups/${group.id}/collections?format=versions`,
				status: 200,
				headers: headers,
				json: {
					"AAAAAAAA": 1
				}
			});
			setResponse({
				method: "GET",
				url: `groups/${group.id}/searches?format=versions`,
				status: 200,
				headers: headers,
				json: {
					"AAAAAAAA": 2
				}
			});
			setResponse({
				method: "GET",
				url: `groups/${group.id}/items/top?format=versions&includeTrashed=1`,
				status: 200,
				headers: headers,
				json: {
					"AAAAAAAA": 3
				}
			});
			setResponse({
				method: "GET",
				url: `groups/${group.id}/items?format=versions&includeTrashed=1`,
				status: 200,
				headers: headers,
				json: {
					"AAAAAAAA": 3,
					"BBBBBBBB": 3
				}
			});
			setResponse({
				method: "GET",
				url: `groups/${group.id}/collections?format=json&collectionKey=AAAAAAAA`,
				status: 200,
				headers: headers,
				json: [
					makeCollectionJSON({
						key: "AAAAAAAA",
						version: 1,
						name: "A"
					})
				]
			});
			setResponse({
				method: "GET",
				url: `groups/${group.id}/searches?format=json&searchKey=AAAAAAAA`,
				status: 200,
				headers: headers,
				json: [
					makeSearchJSON({
						key: "AAAAAAAA",
						version: 2,
						name: "A"
					})
				]
			});
			setResponse({
				method: "GET",
				url: `groups/${group.id}/items?format=json&itemKey=AAAAAAAA&includeTrashed=1`,
				status: 200,
				headers: headers,
				json: [
					makeItemJSON({
						key: "AAAAAAAA",
						version: 3,
						itemType: "book",
						title: "A"
					})
				]
			});
			setResponse({
				method: "GET",
				url: `groups/${group.id}/items?format=json&itemKey=BBBBBBBB&includeTrashed=1`,
				status: 200,
				headers: headers,
				json: [
					makeItemJSON({
						key: "BBBBBBBB",
						version: 3,
						itemType: "note",
						parentItem: "AAAAAAAA",
						note: "This is a note."
					})
				]
			});
			setResponse({
				method: "GET",
				url: `groups/${group.id}/deleted?since=0`,
				status: 200,
				headers: headers,
				json: {
					"items": [itemToDelete.key]
				}
			});
			yield engine.start();
			
			// Check local library version
			assert.equal(group.libraryVersion, 3);
			
			// Make sure local objects exist
			var setting = Zotero.SyncedSettings.get(libraryID, "tagColors");
			assert.lengthOf(setting, 1);
			assert.equal(setting[0].name, 'A');
			var settingMetadata = Zotero.SyncedSettings.getMetadata(libraryID, "tagColors");
			assert.equal(settingMetadata.version, 2);
			assert.isTrue(settingMetadata.synced);
			
			var obj = Zotero.Collections.getByLibraryAndKey(libraryID, "AAAAAAAA");
			assert.equal(obj.name, 'A');
			assert.equal(obj.version, 1);
			assert.isTrue(obj.synced);
			yield assertInCache(obj);
			
			obj = Zotero.Searches.getByLibraryAndKey(libraryID, "AAAAAAAA");
			assert.equal(obj.name, 'A');
			assert.equal(obj.version, 2);
			assert.isTrue(obj.synced);
			yield assertInCache(obj);
			
			obj = Zotero.Items.getByLibraryAndKey(libraryID, "AAAAAAAA");
			assert.equal(obj.getField('title'), 'A');
			assert.equal(obj.version, 3);
			assert.isTrue(obj.synced);
			var parentItemID = obj.id;
			yield assertInCache(obj);
			
			obj = Zotero.Items.getByLibraryAndKey(libraryID, "BBBBBBBB");
			assert.equal(obj.getNote(), 'This is a note.');
			assert.equal(obj.parentItemID, parentItemID);
			assert.equal(obj.version, 3);
			assert.isTrue(obj.synced);
			yield assertInCache(obj);
			
			assert.isFalse(Zotero.Items.exists(itemToDeleteID));
		});
		
		it("should upload new full items and subsequent patches", function* () {
			({ engine, client, caller } = yield setup());
			
			var library = Zotero.Libraries.userLibrary;
			var libraryID = library.id;
			var lastLibraryVersion = 5;
			library.libraryVersion = lastLibraryVersion;
			yield library.saveTx();
			
			yield Zotero.SyncedSettings.set(libraryID, "testSetting1", { foo: "bar" });
			yield Zotero.SyncedSettings.set(libraryID, "testSetting2", { bar: "foo" });
			
			var types = Zotero.DataObjectUtilities.getTypes();
			var objects = {};
			var objectResponseJSON = {};
			var objectVersions = {};
			for (let type of types) {
				objects[type] = [yield createDataObject(type, { setTitle: true })];
				objectVersions[type] = {};
				objectResponseJSON[type] = objects[type].map(o => o.toResponseJSON());
			}
			
			server.respond(function (req) {
				if (req.method == "POST") {
					assert.equal(
						req.requestHeaders["If-Unmodified-Since-Version"], lastLibraryVersion
					);
					
					// Both settings should be uploaded
					if (req.url == baseURL + "users/1/settings") {
						let json = JSON.parse(req.requestBody);
						assert.lengthOf(Object.keys(json), 2);
						assert.property(json, "testSetting1");
						assert.property(json, "testSetting2");
						assert.property(json.testSetting1, "value");
						assert.property(json.testSetting2, "value");
						assert.propertyVal(json.testSetting1.value, "foo", "bar");
						assert.propertyVal(json.testSetting2.value, "bar", "foo");
						req.respond(
							204,
							{
								"Last-Modified-Version": ++lastLibraryVersion
							},
							""
						);
						return;
					}
					
					for (let type of types) {
						let typePlural = Zotero.DataObjectUtilities.getObjectTypePlural(type);
						if (req.url == baseURL + "users/1/" + typePlural) {
							let json = JSON.parse(req.requestBody);
							assert.lengthOf(json, 1);
							assert.equal(json[0].key, objects[type][0].key);
							assert.equal(json[0].version, 0);
							if (type == 'item') {
								assert.equal(json[0].title, objects[type][0].getField('title'));
							}
							else {
								assert.equal(json[0].name, objects[type][0].name);
							}
							let objectJSON = objectResponseJSON[type][0];
							objectJSON.version = ++lastLibraryVersion;
							objectJSON.data.version = lastLibraryVersion;
							req.respond(
								200,
								{
									"Content-Type": "application/json",
									"Last-Modified-Version": lastLibraryVersion
								},
								JSON.stringify({
									successful: {
										"0": objectJSON
									},
									unchanged: {},
									failed: {}
								})
							);
							objectVersions[type][objects[type][0].key] = lastLibraryVersion;
							return;
						}
					}
				}
			})
			
			yield engine.start();
			
			yield Zotero.SyncedSettings.set(libraryID, "testSetting2", { bar: "bar" });
			
			assert.equal(Zotero.Libraries.getVersion(libraryID), lastLibraryVersion);
			for (let type of types) {
				// Make sure objects were set to the correct version and marked as synced
				assert.lengthOf((yield Zotero.Sync.Data.Local.getUnsynced(type, libraryID)), 0);
				let key = objects[type][0].key;
				let version = objects[type][0].version;
				assert.equal(version, objectVersions[type][key]);
				// Make sure uploaded objects were added to cache
				let cached = yield Zotero.Sync.Data.Local.getCacheObject(type, libraryID, key, version);
				assert.typeOf(cached, 'object');
				assert.equal(cached.key, key);
				assert.equal(cached.version, version);
				
				yield modifyDataObject(objects[type][0]);
			}
			
			({ engine, client, caller } = yield setup());
			
			server.respond(function (req) {
				if (req.method == "POST") {
					assert.equal(
						req.requestHeaders["If-Unmodified-Since-Version"], lastLibraryVersion
					);
					
					// Modified setting should be uploaded
					if (req.url == baseURL + "users/1/settings") {
						let json = JSON.parse(req.requestBody);
						assert.lengthOf(Object.keys(json), 1);
						assert.property(json, "testSetting2");
						assert.property(json.testSetting2, "value");
						assert.propertyVal(json.testSetting2.value, "bar", "bar");
						req.respond(
							204,
							{
								"Last-Modified-Version": ++lastLibraryVersion
							},
							""
						);
						return;
					}
					
					for (let type of types) {
						let typePlural = Zotero.DataObjectUtilities.getObjectTypePlural(type);
						if (req.url == baseURL + "users/1/" + typePlural) {
							let json = JSON.parse(req.requestBody);
							assert.lengthOf(json, 1);
							let j = json[0];
							let o = objects[type][0];
							assert.equal(j.key, o.key);
							assert.equal(j.version, objectVersions[type][o.key]);
							if (type == 'item') {
								assert.equal(j.title, o.getField('title'));
							}
							else {
								assert.equal(j.name, o.name);
							}
							
							// Verify PATCH semantics instead of POST (i.e., only changed fields)
							let changedFieldsExpected = ['key', 'version'];
							if (type == 'item') {
								changedFieldsExpected.push('title', 'dateModified');
							}
							else {
								changedFieldsExpected.push('name');
							}
							let changedFields = Object.keys(j);
							assert.lengthOf(
								changedFields, changedFieldsExpected.length, "same " + type + " length"
							);
							assert.sameMembers(
								changedFields, changedFieldsExpected, "same " + type + " members"
							);
							let objectJSON = objectResponseJSON[type][0];
							objectJSON.version = ++lastLibraryVersion;
							objectJSON.data.version = lastLibraryVersion;
							req.respond(
								200,
								{
									"Content-Type": "application/json",
									"Last-Modified-Version": lastLibraryVersion
								},
								JSON.stringify({
									successful: {
										"0": objectJSON
									},
									unchanged: {},
									failed: {}
								})
							);
							objectVersions[type][o.key] = lastLibraryVersion;
							return;
						}
					}
				}
			})
			
			yield engine.start();
			
			assert.equal(Zotero.Libraries.getVersion(libraryID), lastLibraryVersion);
			for (let type of types) {
				// Make sure objects were set to the correct version and marked as synced
				assert.lengthOf((yield Zotero.Sync.Data.Local.getUnsynced(type, libraryID)), 0);
				let o = objects[type][0];
				let key = o.key;
				let version = o.version;
				assert.equal(version, objectVersions[type][key]);
				// Make sure uploaded objects were added to cache
				let cached = yield Zotero.Sync.Data.Local.getCacheObject(type, libraryID, key, version);
				assert.typeOf(cached, 'object');
				assert.equal(cached.key, key);
				assert.equal(cached.version, version);
				
				switch (type) {
				case 'collection':
					assert.isFalse(cached.data.parentCollection);
					break;
				
				case 'item':
					assert.equal(cached.data.dateAdded, Zotero.Date.sqlToISO8601(o.dateAdded));
					break;
				
				case 'search':
					assert.isArray(cached.data.conditions);
					break;
				}
			}
		})
		
		
		it("should upload child item after parent item", function* () {
			({ engine, client, caller } = yield setup());
			
			var library = Zotero.Libraries.userLibrary;
			var lastLibraryVersion = 5;
			library.libraryVersion = lastLibraryVersion;
			yield library.saveTx();
			
			// Create top-level note, book, and child note
			var item1 = new Zotero.Item('note');
			item1.setNote('A');
			yield item1.saveTx();
			var item2 = yield createDataObject('item');
			var item3 = new Zotero.Item('note');
			item3.parentItemID = item2.id;
			item3.setNote('B');
			yield item3.saveTx();
			// Move note under parent
			item1.parentItemID = item2.id;
			yield item1.saveTx();
			var handled = false;
			
			server.respond(function (req) {
				if (req.method == "POST" && req.url == baseURL + "users/1/items") {
					let json = JSON.parse(req.requestBody);
					assert.lengthOf(json, 3);
					assert.equal(json[0].key, item2.key);
					assert.equal(json[1].key, item1.key);
					assert.equal(json[2].key, item3.key);
					handled = true;
					req.respond(
						200,
						{
							"Content-Type": "application/json",
							"Last-Modified-Version": ++lastLibraryVersion
						},
						JSON.stringify({
							successful: {
								"0": item2.toResponseJSON(),
								"1": item1.toResponseJSON(),
								"2": item3.toResponseJSON()
							},
							unchanged: {},
							failed: {}
						})
					);
					return;
				}
			});
			
			yield engine.start();
			assert.isTrue(handled);
		});
		
		
		it("should upload child collection after parent collection", function* () {
			({ engine, client, caller } = yield setup());
			
			var library = Zotero.Libraries.userLibrary;
			var lastLibraryVersion = 5;
			library.libraryVersion = lastLibraryVersion;
			yield library.saveTx();
			
			var collection1 = yield createDataObject('collection');
			var collection2 = yield createDataObject('collection');
			var collection3 = yield createDataObject('collection', { parentID: collection2.id });
			// Move collection under the other
			collection1.parentID = collection2.id;
			yield collection1.saveTx();
			
			var handled = false;
			
			server.respond(function (req) {
				if (req.method == "POST" && req.url == baseURL + "users/1/collections") {
					let json = JSON.parse(req.requestBody);
					assert.lengthOf(json, 3);
					assert.equal(json[0].key, collection2.key);
					assert.equal(json[1].key, collection1.key);
					assert.equal(json[2].key, collection3.key);
					handled = true;
					req.respond(
						200,
						{
							"Content-Type": "application/json",
							"Last-Modified-Version": ++lastLibraryVersion
						},
						JSON.stringify({
							successful: {
								"0": collection2.toResponseJSON(),
								"1": collection1.toResponseJSON(),
								"2": collection3.toResponseJSON()
							},
							unchanged: {},
							failed: {}
						})
					);
					return;
				}
			});
			
			yield engine.start();
			assert.isTrue(handled);
		});
		
		
		it("shouldn't include storage properties for attachments in ZFS libraries", function* () {
			({ engine, client, caller } = yield setup());
			
			var library = Zotero.Libraries.userLibrary;
			var lastLibraryVersion = 2;
			library.libraryVersion = lastLibraryVersion;
			yield library.saveTx();
			
			var item = new Zotero.Item('attachment');
			item.attachmentLinkMode = 'imported_file';
			item.attachmentFilename = 'test.txt';
			item.attachmentContentType = 'text/plain';
			item.attachmentCharset = 'utf-8';
			yield item.saveTx();
			
			var itemResponseJSON = item.toResponseJSON();
			itemResponseJSON.version = itemResponseJSON.data.version = lastLibraryVersion;
			
			server.respond(function (req) {
				if (req.method == "POST") {
					if (req.url == baseURL + "users/1/items") {
						let json = JSON.parse(req.requestBody);
						assert.lengthOf(json, 1);
						let itemJSON = json[0];
						assert.equal(itemJSON.key, item.key);
						assert.equal(itemJSON.version, 0);
						assert.property(itemJSON, "contentType");
						assert.property(itemJSON, "charset");
						assert.property(itemJSON, "filename");
						assert.notProperty(itemJSON, "mtime");
						assert.notProperty(itemJSON, "md5");
						req.respond(
							200,
							{
								"Content-Type": "application/json",
								"Last-Modified-Version": lastLibraryVersion
							},
							JSON.stringify({
								successful: {
									"0": itemResponseJSON
								},
								unchanged: {},
								failed: {}
							})
						);
						return;
					}
				}
			})
			
			yield engine.start();
		});
		
		
		it("should include storage properties for attachments in WebDAV libraries", function* () {
			({ engine, client, caller } = yield setup());
			
			var library = Zotero.Libraries.userLibrary;
			var lastLibraryVersion = 2;
			library.libraryVersion = lastLibraryVersion;
			yield library.saveTx();
			Zotero.Sync.Storage.Local.setModeForLibrary(library.id, 'webdav');
			
			var item = new Zotero.Item('attachment');
			item.attachmentLinkMode = 'imported_file';
			item.attachmentFilename = 'test.txt';
			item.attachmentContentType = 'text/plain';
			item.attachmentCharset = 'utf-8';
			yield item.saveTx();
			
			var itemResponseJSON = item.toResponseJSON();
			itemResponseJSON.version = itemResponseJSON.data.version = lastLibraryVersion;
			
			server.respond(function (req) {
				if (req.method == "POST") {
					if (req.url == baseURL + "users/1/items") {
						let json = JSON.parse(req.requestBody);
						assert.lengthOf(json, 1);
						let itemJSON = json[0];
						assert.equal(itemJSON.key, item.key);
						assert.equal(itemJSON.version, 0);
						assert.propertyVal(itemJSON, "contentType", item.attachmentContentType);
						assert.propertyVal(itemJSON, "charset", item.attachmentCharset);
						assert.propertyVal(itemJSON, "filename", item.attachmentFilename);
						assert.propertyVal(itemJSON, "mtime", null);
						assert.propertyVal(itemJSON, "md5", null);
						req.respond(
							200,
							{
								"Content-Type": "application/json",
								"Last-Modified-Version": lastLibraryVersion
							},
							JSON.stringify({
								successful: {
									"0": itemResponseJSON
								},
								unchanged: {},
								failed: {}
							})
						);
						return;
					}
				}
			})
			
			yield engine.start();
		});
		
		
		it("should upload synced storage properties", function* () {
			({ engine, client, caller } = yield setup());
			
			var library = Zotero.Libraries.userLibrary;
			var lastLibraryVersion = 2;
			library.libraryVersion = lastLibraryVersion;
			yield library.saveTx();
			
			var item = new Zotero.Item('attachment');
			item.attachmentLinkMode = 'imported_file';
			item.attachmentFilename = 'test1.txt';
			yield item.saveTx();
			
			var mtime = new Date().getTime();
			var md5 = '57f8a4fda823187b91e1191487b87fe6';
			
			item.attachmentSyncedModificationTime = mtime;
			item.attachmentSyncedHash = md5;
			yield item.saveTx({ skipAll: true });
			
			var itemResponseJSON = item.toResponseJSON();
			itemResponseJSON.version = itemResponseJSON.data.version = lastLibraryVersion;
			itemResponseJSON.data.mtime = mtime;
			itemResponseJSON.data.md5 = md5;
			
			server.respond(function (req) {
				if (req.method == "POST") {
					if (req.url == baseURL + "users/1/items") {
						let json = JSON.parse(req.requestBody);
						assert.lengthOf(json, 1);
						let itemJSON = json[0];
						assert.equal(itemJSON.key, item.key);
						assert.equal(itemJSON.version, 0);
						assert.equal(itemJSON.mtime, mtime);
						assert.equal(itemJSON.md5, md5);
						req.respond(
							200,
							{
								"Content-Type": "application/json",
								"Last-Modified-Version": lastLibraryVersion
							},
							JSON.stringify({
								successful: {
									"0": itemResponseJSON
								},
								unchanged: {},
								failed: {}
							})
						);
						return;
					}
				}
			})
			
			yield engine.start();
			
			// Check data in cache
			var json = yield Zotero.Sync.Data.Local.getCacheObject(
				'item', library.id, item.key, lastLibraryVersion
			);
			assert.equal(json.data.mtime, mtime);
			assert.equal(json.data.md5, md5);
		})
		
		it("should update local objects with remotely saved version after uploading if necessary", function* () {
			({ engine, client, caller } = yield setup());
			
			var library = Zotero.Libraries.userLibrary;
			var libraryID = library.id;
			var lastLibraryVersion = 5;
			library.libraryVersion = lastLibraryVersion;
			yield library.saveTx();
			
			var types = Zotero.DataObjectUtilities.getTypes();
			var objects = {};
			var objectResponseJSON = {};
			var objectNames = {};
			var itemDateModified = {};
			for (let type of types) {
				objects[type] = [
					yield createDataObject(
						type, { setTitle: true, dateModified: '2016-05-21 01:00:00' }
					)
				];
				objectNames[type] = {};
				objectResponseJSON[type] = objects[type].map(o => o.toResponseJSON());
				if (type == 'item') {
					let item = objects[type][0];
					itemDateModified[item.key] = item.dateModified;
				}
			}
			
			server.respond(function (req) {
				if (req.method == "POST") {
					assert.equal(
						req.requestHeaders["If-Unmodified-Since-Version"], lastLibraryVersion
					);
					
					for (let type of types) {
						let typePlural = Zotero.DataObjectUtilities.getObjectTypePlural(type);
						if (req.url == baseURL + "users/1/" + typePlural) {
							let key = objects[type][0].key;
							let objectJSON = objectResponseJSON[type][0];
							objectJSON.version = ++lastLibraryVersion;
							objectJSON.data.version = lastLibraryVersion;
							let prop = type == 'item' ? 'title' : 'name';
							objectNames[type][key] = objectJSON.data[prop] = Zotero.Utilities.randomString();
							req.respond(
								200,
								{
									"Content-Type": "application/json",
									"Last-Modified-Version": lastLibraryVersion
								},
								JSON.stringify({
									successful: {
										"0": objectJSON
									},
									unchanged: {},
									failed: {}
								})
							);
							return;
						}
					}
				}
			})
			
			yield engine.start();
			
			assert.equal(library.libraryVersion, lastLibraryVersion);
			for (let type of types) {
				// Make sure local objects were updated with new metadata and marked as synced
				assert.lengthOf((yield Zotero.Sync.Data.Local.getUnsynced(type, libraryID)), 0);
				let o = objects[type][0];
				let key = o.key;
				let version = o.version;
				let name = objectNames[type][key];
				if (type == 'item') {
					assert.equal(name, o.getField('title'));
					
					// But Date Modified shouldn't have changed for items
					assert.equal(itemDateModified[key], o.dateModified);
				}
				else {
					assert.equal(name, o.name);
				}
			}
		})
		
		it("should upload local deletions", function* () {
			var { engine, client, caller } = yield setup();
			var library = Zotero.Libraries.userLibrary;
			var lastLibraryVersion = 5;
			library.libraryVersion = lastLibraryVersion;
			yield library.saveTx();
			
			
			var types = Zotero.DataObjectUtilities.getTypes();
			var objects = {};
			for (let type of types) {
				let obj1 = yield createDataObject(type);
				let obj2 = yield createDataObject(type);
				objects[type] = [obj1.key, obj2.key];
				yield obj1.eraseTx();
				yield obj2.eraseTx();
			}
			
			var count = types.length;
			
			server.respond(function (req) {
				if (req.method == "DELETE") {
					assert.equal(
						req.requestHeaders["If-Unmodified-Since-Version"], lastLibraryVersion
					);
					
					// TODO: Settings?
					
					// Data objects
					for (let type of types) {
						let typePlural = Zotero.DataObjectUtilities.getObjectTypePlural(type);
						if (req.url.startsWith(baseURL + "users/1/" + typePlural)) {
							let matches = req.url.match(new RegExp("\\?" + type + "Key=(.+)"));
							let keys = decodeURIComponent(matches[1]).split(',');
							assert.sameMembers(keys, objects[type]);
							req.respond(
								204,
								{
									"Last-Modified-Version": ++lastLibraryVersion
								}
							);
							count--;
							return;
						}
					}
				}
			})
			
			yield engine.start();
			
			assert.equal(count, 0);
			for (let type of types) {
				yield assert.eventually.lengthOf(
					Zotero.Sync.Data.Local.getDeleted(type, library.id), 0
				);
			}
			assert.equal(library.libraryVersion, lastLibraryVersion);
		})
		
		it("should make only one request if in sync", function* () {
			var library = Zotero.Libraries.userLibrary;
			library.libraryVersion = 5;
			yield library.saveTx();
			({ engine, client, caller } = yield setup());
			
			server.respond(function (req) {
				if (req.method == "GET" && req.url == baseURL + "users/1/settings?since=5") {
					let since = req.requestHeaders["If-Modified-Since-Version"];
					if (since == 5) {
						req.respond(304);
						return;
					}
				}
			});
			yield engine.start();
		})
		
		it("should ignore errors when saving downloaded objects", function* () {
			({ engine, client, caller } = yield setup());
			engine.stopOnError = false;
			
			var headers = {
				"Last-Modified-Version": 3
			};
			setResponse({
				method: "GET",
				url: "users/1/settings",
				status: 200,
				headers: headers,
				json: {}
			});
			setResponse({
				method: "GET",
				url: "users/1/collections?format=versions",
				status: 200,
				headers: headers,
				json: {
					"AAAAAAAA": 1,
					"BBBBBBBB": 1,
					"CCCCCCCC": 1
				}
			});
			setResponse({
				method: "GET",
				url: "users/1/searches?format=versions",
				status: 200,
				headers: headers,
				json: {
					"DDDDDDDD": 2,
					"EEEEEEEE": 2,
					"FFFFFFFF": 2
				}
			});
			setResponse({
				method: "GET",
				url: "users/1/items/top?format=versions&includeTrashed=1",
				status: 200,
				headers: headers,
				json: {
					"GGGGGGGG": 3,
					"HHHHHHHH": 3
				}
			});
			setResponse({
				method: "GET",
				url: "users/1/items?format=versions&includeTrashed=1",
				status: 200,
				headers: headers,
				json: {
					"GGGGGGGG": 3,
					"HHHHHHHH": 3,
					"JJJJJJJJ": 3
				}
			});
			setResponse({
				method: "GET",
				url: "users/1/collections?format=json&collectionKey=AAAAAAAA%2CBBBBBBBB%2CCCCCCCCC",
				status: 200,
				headers: headers,
				json: [
					makeCollectionJSON({
						key: "AAAAAAAA",
						version: 1,
						name: "A"
					}),
					makeCollectionJSON({
						key: "BBBBBBBB",
						version: 1,
						name: "B",
						// Missing parent -- collection should be queued
						parentCollection: "ZZZZZZZZ"
					}),
					makeCollectionJSON({
						key: "CCCCCCCC",
						version: 1,
						name: "C",
						// Unknown field -- should be ignored
						unknownField: 5
					})
				]
			});
			setResponse({
				method: "GET",
				url: "users/1/searches?format=json&searchKey=DDDDDDDD%2CEEEEEEEE%2CFFFFFFFF",
				status: 200,
				headers: headers,
				json: [
					makeSearchJSON({
						key: "DDDDDDDD",
						version: 2,
						name: "D",
						conditions: [
							{
								condition: "title",
								operator: "is",
								value: "a"
							}
						]
					}),
					makeSearchJSON({
						key: "EEEEEEEE",
						version: 2,
						name: "E",
						conditions: [
							{
								// Unknown search condition -- search should be queued
								condition: "unknownCondition",
								operator: "is",
								value: "a"
							}
						]
					}),
					makeSearchJSON({
						key: "FFFFFFFF",
						version: 2,
						name: "F",
						conditions: [
							{
								condition: "title",
								// Unknown search operator -- search should be queued
								operator: "unknownOperator",
								value: "a"
							}
						]
					})
				]
			});
			setResponse({
				method: "GET",
				url: "users/1/items?format=json&itemKey=GGGGGGGG%2CHHHHHHHH&includeTrashed=1",
				status: 200,
				headers: headers,
				json: [
					makeItemJSON({
						key: "GGGGGGGG",
						version: 3,
						itemType: "book",
						title: "G",
						// Unknown item field -- should be ignored
						unknownField: "B"
					}),
					makeItemJSON({
						key: "HHHHHHHH",
						version: 3,
						// Unknown item type -- item should be queued
						itemType: "unknownItemType",
						title: "H"
					})
				]
			});
			setResponse({
				method: "GET",
				url: "users/1/items?format=json&itemKey=JJJJJJJJ&includeTrashed=1",
				status: 200,
				headers: headers,
				json: [
					makeItemJSON({
						key: "JJJJJJJJ",
						version: 3,
						itemType: "note",
						// Parent that couldn't be saved -- item should be queued
						parentItem: "HHHHHHHH",
						note: "This is a note."
					})
				]
			});
			setResponse({
				method: "GET",
				url: "users/1/deleted?since=0",
				status: 200,
				headers: headers,
				json: {}
			});
			var spy = sinon.spy(engine, "onError");
			yield engine.start();
			
			var userLibraryID = Zotero.Libraries.userLibraryID;
			
			// Library version should have been updated
			assert.equal(Zotero.Libraries.getVersion(userLibraryID), 3);
			
			// Check for saved objects
			yield assert.eventually.ok(Zotero.Collections.getByLibraryAndKeyAsync(userLibraryID, "AAAAAAAA"));
			yield assert.eventually.ok(Zotero.Searches.getByLibraryAndKeyAsync(userLibraryID, "DDDDDDDD"));
			yield assert.eventually.ok(Zotero.Items.getByLibraryAndKeyAsync(userLibraryID, "GGGGGGGG"));
			
			// Check for queued objects
			var keys = yield Zotero.Sync.Data.Local.getObjectsFromSyncQueue('collection', userLibraryID);
			assert.sameMembers(keys, ['BBBBBBBB']);
			
			var keys = yield Zotero.Sync.Data.Local.getObjectsFromSyncQueue('search', userLibraryID);
			assert.sameMembers(keys, ['EEEEEEEE', 'FFFFFFFF']);
			
			var keys = yield Zotero.Sync.Data.Local.getObjectsFromSyncQueue('item', userLibraryID);
			assert.sameMembers(keys, ['HHHHHHHH', 'JJJJJJJJ']);
			
			assert.equal(spy.callCount, 3);
		});
	})
	
	describe("#_startDownload()", function () {
		it("shouldn't redownload objects that are already up to date", function* () {
			var userLibraryID = Zotero.Libraries.userLibraryID;
			//yield Zotero.Libraries.setVersion(userLibraryID, 5);
			({ engine, client, caller } = yield setup());
			
			var objects = {};
			for (let type of Zotero.DataObjectUtilities.getTypes()) {
				let obj = objects[type] = createUnsavedDataObject(type);
				obj.version = 5;
				obj.synced = true;
				yield obj.saveTx({ skipSyncedUpdate: true });
				
				yield Zotero.Sync.Data.Local.saveCacheObjects(
					type,
					userLibraryID,
					[
						{
							key: obj.key,
							version: obj.version,
							data: obj.toJSON()
						}
					]
				);
			}
			
			var json;
			var headers = {
				"Last-Modified-Version": 5
			};
			setResponse({
				method: "GET",
				url: "users/1/settings",
				status: 200,
				headers: headers,
				json: {}
			});
			json = {};
			json[objects.collection.key] = 5;
			setResponse({
				method: "GET",
				url: "users/1/collections?format=versions",
				status: 200,
				headers: headers,
				json: json
			});
			json = {};
			json[objects.search.key] = 5;
			setResponse({
				method: "GET",
				url: "users/1/searches?format=versions",
				status: 200,
				headers: headers,
				json: json
			});
			json = {};
			json[objects.item.key] = 5;
			setResponse({
				method: "GET",
				url: "users/1/items/top?format=versions&includeTrashed=1",
				status: 200,
				headers: headers,
				json: json
			});
			json = {};
			json[objects.item.key] = 5;
			setResponse({
				method: "GET",
				url: "users/1/items?format=versions&includeTrashed=1",
				status: 200,
				headers: headers,
				json: json
			});
			setResponse({
				method: "GET",
				url: "users/1/deleted?since=0",
				status: 200,
				headers: headers,
				json: {}
			});
			
			yield engine._startDownload();
		})
		
		it("should apply remote deletions", function* () {
			var library = Zotero.Libraries.userLibrary;
			library.libraryVersion = 5;
			yield library.saveTx();
			({ engine, client, caller } = yield setup());
			
			// Create objects and mark them as synced
			yield Zotero.SyncedSettings.set(
				library.id, 'tagColors', [{name: 'A', color: '#CC66CC'}], 1, true
			);
			var collection = createUnsavedDataObject('collection');
			collection.synced = true;
			var collectionID = yield collection.saveTx({ skipSyncedUpdate: true });
			var collectionKey = collection.key;
			var search = createUnsavedDataObject('search');
			search.synced = true;
			var searchID = yield search.saveTx({ skipSyncedUpdate: true });
			var searchKey = search.key;
			var item = createUnsavedDataObject('item');
			item.synced = true;
			var itemID = yield item.saveTx({ skipSyncedUpdate: true });
			var itemKey = item.key;
			
			var headers = {
				"Last-Modified-Version": 6
			};
			setResponse({
				method: "GET",
				url: "users/1/settings?since=5",
				status: 200,
				headers: headers,
				json: {}
			});
			setResponse({
				method: "GET",
				url: "users/1/collections?format=versions&since=5",
				status: 200,
				headers: headers,
				json: {}
			});
			setResponse({
				method: "GET",
				url: "users/1/searches?format=versions&since=5",
				status: 200,
				headers: headers,
				json: {}
			});
			setResponse({
				method: "GET",
				url: "users/1/items?format=versions&since=5&includeTrashed=1",
				status: 200,
				headers: headers,
				json: {}
			});
			setResponse({
				method: "GET",
				url: "users/1/items/top?format=versions&since=5&includeTrashed=1",
				status: 200,
				headers: headers,
				json: {}
			});
			setResponse({
				method: "GET",
				url: "users/1/deleted?since=5",
				status: 200,
				headers: headers,
				json: {
					settings: ['tagColors'],
					collections: [collection.key],
					searches: [search.key],
					items: [item.key]
				}
			});
			yield engine._startDownload();
			
			// Make sure objects were deleted
			assert.isNull(Zotero.SyncedSettings.get(library.id, 'tagColors'));
			assert.isFalse(Zotero.Collections.exists(collectionID));
			assert.isFalse(Zotero.Searches.exists(searchID));
			assert.isFalse(Zotero.Items.exists(itemID));
			
			// Make sure objects weren't added to sync delete log
			assert.isFalse(yield Zotero.Sync.Data.Local.getDateDeleted(
				'setting', library.id, 'tagColors'
			));
			assert.isFalse(yield Zotero.Sync.Data.Local.getDateDeleted(
				'collection', library.id, collectionKey
			));
			assert.isFalse(yield Zotero.Sync.Data.Local.getDateDeleted(
				'search', library.id, searchKey
			));
			assert.isFalse(yield Zotero.Sync.Data.Local.getDateDeleted(
				'item', library.id, itemKey
			));
		})
		
		it("should ignore remote deletions for non-item objects if local objects changed", function* () {
			var library = Zotero.Libraries.userLibrary;
			library.libraryVersion = 5;
			yield library.saveTx();
			({ engine, client, caller } = yield setup());
			
			// Create objects marked as unsynced
			yield Zotero.SyncedSettings.set(
				library.id, 'tagColors', [{name: 'A', color: '#CC66CC'}]
			);
			var collection = createUnsavedDataObject('collection');
			var collectionID = yield collection.saveTx();
			var collectionKey = collection.key;
			var search = createUnsavedDataObject('search');
			var searchID = yield search.saveTx();
			var searchKey = search.key;
			
			var headers = {
				"Last-Modified-Version": 6
			};
			setResponse({
				method: "GET",
				url: "users/1/settings?since=5",
				status: 200,
				headers: headers,
				json: {}
			});
			setResponse({
				method: "GET",
				url: "users/1/collections?format=versions&since=5",
				status: 200,
				headers: headers,
				json: {}
			});
			setResponse({
				method: "GET",
				url: "users/1/searches?format=versions&since=5",
				status: 200,
				headers: headers,
				json: {}
			});
			setResponse({
				method: "GET",
				url: "users/1/items/top?format=versions&since=5&includeTrashed=1",
				status: 200,
				headers: headers,
				json: {}
			});
			setResponse({
				method: "GET",
				url: "users/1/items?format=versions&since=5&includeTrashed=1",
				status: 200,
				headers: headers,
				json: {}
			});
			setResponse({
				method: "GET",
				url: "users/1/deleted?since=5",
				status: 200,
				headers: headers,
				json: {
					settings: ['tagColors'],
					collections: [collection.key],
					searches: [search.key],
					items: []
				}
			});
			yield engine._startDownload();
			
			// Make sure objects weren't deleted
			assert.ok(Zotero.SyncedSettings.get(library.id, 'tagColors'));
			assert.ok(Zotero.Collections.exists(collectionID));
			assert.ok(Zotero.Searches.exists(searchID));
		})
		
		it("should show conflict resolution window for conflicting remote deletions", function* () {
			var library = Zotero.Libraries.userLibrary;
			library.libraryVersion = 5;
			yield library.saveTx();
			({ engine, client, caller } = yield setup());
			
			// Create local unsynced items
			var item = createUnsavedDataObject('item');
			item.setField('title', 'A');
			item.synced = false;
			var itemID1 = yield item.saveTx({ skipSyncedUpdate: true });
			var itemKey1 = item.key;
			
			item = createUnsavedDataObject('item');
			item.setField('title', 'B');
			item.synced = false;
			var itemID2 = yield item.saveTx({ skipSyncedUpdate: true });
			var itemKey2 = item.key;
			
			var headers = {
				"Last-Modified-Version": 6
			};
			setResponse({
				method: "GET",
				url: "users/1/settings?since=5",
				status: 200,
				headers: headers,
				json: {}
			});
			setResponse({
				method: "GET",
				url: "users/1/collections?format=versions&since=5",
				status: 200,
				headers: headers,
				json: {}
			});
			setResponse({
				method: "GET",
				url: "users/1/searches?format=versions&since=5",
				status: 200,
				headers: headers,
				json: {}
			});
			setResponse({
				method: "GET",
				url: "users/1/items/top?format=versions&since=5&includeTrashed=1",
				status: 200,
				headers: headers,
				json: {}
			});
			setResponse({
				method: "GET",
				url: "users/1/items?format=versions&since=5&includeTrashed=1",
				status: 200,
				headers: headers,
				json: {}
			});
			setResponse({
				method: "GET",
				url: "users/1/deleted?since=5",
				status: 200,
				headers: headers,
				json: {
					settings: [],
					collections: [],
					searches: [],
					items: [itemKey1, itemKey2]
				}
			});
			
			waitForWindow('chrome://zotero/content/merge.xul', function (dialog) {
				var doc = dialog.document;
				var wizard = doc.documentElement;
				var mergeGroup = wizard.getElementsByTagName('zoteromergegroup')[0];
				
				// 1 (accept remote deletion)
				assert.equal(mergeGroup.leftpane.getAttribute('selected'), 'true');
				mergeGroup.rightpane.click();
				wizard.getButton('next').click();
				
				// 2 (ignore remote deletion)
				assert.equal(mergeGroup.leftpane.getAttribute('selected'), 'true');
				wizard.getButton('finish').click();
			})
			yield engine._startDownload();
			
			assert.isFalse(Zotero.Items.exists(itemID1));
			assert.isTrue(Zotero.Items.exists(itemID2));
		})
		
		it("should handle cancellation of conflict resolution window", function* () {
			var library = Zotero.Libraries.userLibrary;
			library.libraryVersion = 5;
			yield library.saveTx();
			({ engine, client, caller } = yield setup());
			
			var item = yield createDataObject('item');
			var itemID = yield item.saveTx();
			var itemKey = item.key;
			
			var headers = {
				"Last-Modified-Version": 6
			};
			setResponse({
				method: "GET",
				url: "users/1/settings?since=5",
				status: 200,
				headers: headers,
				json: {}
			});
			setResponse({
				method: "GET",
				url: "users/1/collections?format=versions&since=5",
				status: 200,
				headers: headers,
				json: {}
			});
			setResponse({
				method: "GET",
				url: "users/1/searches?format=versions&since=5",
				status: 200,
				headers: headers,
				json: {}
			});
			setResponse({
				method: "GET",
				url: "users/1/items/top?format=versions&since=5&includeTrashed=1",
				status: 200,
				headers: headers,
				json: {
					AAAAAAAA: 6,
					[itemKey]: 6
				}
			});
			setResponse({
				method: "GET",
				url: `users/1/items?format=json&itemKey=AAAAAAAA%2C${itemKey}&includeTrashed=1`,
				status: 200,
				headers: headers,
				json: [
					makeItemJSON({
						key: "AAAAAAAA",
						version: 6,
						itemType: "book",
						title: "B"
					}),
					makeItemJSON({
						key: itemKey,
						version: 6,
						itemType: "book",
						title: "B"
					})
				]
			});
			setResponse({
				method: "GET",
				url: "users/1/items?format=versions&since=5&includeTrashed=1",
				status: 200,
				headers: headers,
				json: {}
			});
			setResponse({
				method: "GET",
				url: "users/1/deleted?since=5",
				status: 200,
				headers: headers,
				json: {
					settings: [],
					collections: [],
					searches: [],
					items: []
				}
			});
			
			waitForWindow('chrome://zotero/content/merge.xul', function (dialog) {
				var doc = dialog.document;
				var wizard = doc.documentElement;
				wizard.getButton('cancel').click();
			})
			var e = yield getPromiseError(engine._startDownload());
			assert.isTrue(e instanceof Zotero.Sync.UserCancelledException);
			
			// Non-conflicted item should be saved
			assert.ok(Zotero.Items.getIDFromLibraryAndKey(library.id, "AAAAAAAA"));
			
			// Conflicted item should be skipped and in queue
			assert.isFalse(Zotero.Items.exists(itemID));
			var keys = yield Zotero.Sync.Data.Local.getObjectsFromSyncQueue('item', library.id);
			assert.sameMembers(keys, [itemKey]);
			
			// Library version should not have advanced
			assert.equal(library.libraryVersion, 5);
		});
		
		
		/**
		 * The CR window for remote deletions is triggered separately, so test separately
		 */
		it("should handle cancellation of remote deletion conflict resolution window", function* () {
			var library = Zotero.Libraries.userLibrary;
			library.libraryVersion = 5;
			yield library.saveTx();
			({ engine, client, caller } = yield setup());
			
			// Create local unsynced items
			var item = createUnsavedDataObject('item');
			item.setField('title', 'A');
			item.synced = false;
			var itemID1 = yield item.saveTx();
			var itemKey1 = item.key;
			
			item = createUnsavedDataObject('item');
			item.setField('title', 'B');
			item.synced = false;
			var itemID2 = yield item.saveTx();
			var itemKey2 = item.key;
			
			var headers = {
				"Last-Modified-Version": 6
			};
			setResponse({
				method: "GET",
				url: "users/1/settings?since=5",
				status: 200,
				headers,
				json: {}
			});
			setResponse({
				method: "GET",
				url: "users/1/collections?format=versions&since=5",
				status: 200,
				headers,
				json: {}
			});
			setResponse({
				method: "GET",
				url: "users/1/searches?format=versions&since=5",
				status: 200,
				headers,
				json: {}
			});
			setResponse({
				method: "GET",
				url: "users/1/items/top?format=versions&since=5&includeTrashed=1",
				status: 200,
				headers,
				json: {}
			});
			setResponse({
				method: "GET",
				url: "users/1/items?format=versions&since=5&includeTrashed=1",
				status: 200,
				headers,
				json: {}
			});
			setResponse({
				method: "GET",
				url: "users/1/deleted?since=5",
				status: 200,
				headers,
				json: {
					settings: [],
					collections: [],
					searches: [],
					items: [itemKey1, itemKey2]
				}
			});
			
			waitForWindow('chrome://zotero/content/merge.xul', function (dialog) {
				var doc = dialog.document;
				var wizard = doc.documentElement;
				wizard.getButton('cancel').click();
			})
			var e = yield getPromiseError(engine._startDownload());
			assert.isTrue(e instanceof Zotero.Sync.UserCancelledException);
			
			// Conflicted items should still exists
			assert.isTrue(Zotero.Items.exists(itemID1));
			assert.isTrue(Zotero.Items.exists(itemID2));
			
			// Library version should not have advanced
			assert.equal(library.libraryVersion, 5);
		});
	});
	
	
	describe("#_startUpload()", function () {
		it("shouldn't upload unsynced objects if present in sync queue", function* () {
			({ engine, client, caller } = yield setup());
			var libraryID = Zotero.Libraries.userLibraryID;
			var objectType = 'item';
			var obj = yield createDataObject(objectType);
			yield Zotero.Sync.Data.Local.addObjectsToSyncQueue(objectType, libraryID, [obj.key]);
			var result = yield engine._startUpload();
			assert.equal(result, engine.UPLOAD_RESULT_NOTHING_TO_UPLOAD);
		});
	});
	
	
	describe("Conflict Resolution", function () {
		beforeEach(function* () {
			yield Zotero.DB.queryAsync("DELETE FROM syncCache");
		})
		
		after(function* () {
			yield Zotero.DB.queryAsync("DELETE FROM syncCache");
		})
		
		it("should show conflict resolution window on item conflicts", function* () {
			var libraryID = Zotero.Libraries.userLibraryID;
			({ engine, client, caller } = yield setup());
			var type = 'item';
			var objects = [];
			var values = [];
			var dateAdded = Date.now() - 86400000;
			var responseJSON = [];
			
			for (let i = 0; i < 2; i++) {
				values.push({
					left: {},
					right: {}
				});
				
				// Create local object
				let obj = objects[i] = yield createDataObject(
					type,
					{
						version: 10,
						dateAdded: Zotero.Date.dateToSQL(new Date(dateAdded), true),
						// Set Date Modified values one minute apart to enforce order
						dateModified: Zotero.Date.dateToSQL(
							new Date(dateAdded + (i * 60000)), true
						)
					}
				);
				let jsonData = obj.toJSON();
				jsonData.key = obj.key;
				jsonData.version = 10;
				let json = {
					key: obj.key,
					version: jsonData.version,
					data: jsonData
				};
				// Save original version in cache
				yield Zotero.Sync.Data.Local.saveCacheObjects(type, libraryID, [json]);
				
				// Create updated JSON for download
				values[i].right.title = jsonData.title = Zotero.Utilities.randomString();
				values[i].right.version = json.version = jsonData.version = 15;
				responseJSON.push(json);
				
				// Modify object locally
				yield modifyDataObject(obj, undefined, { skipDateModifiedUpdate: true });
				values[i].left.title = obj.getField('title');
				values[i].left.version = obj.getField('version');
			}
			
			setResponse({
				method: "GET",
				url: `users/1/items?format=json&itemKey=${objects.map(o => o.key).join('%2C')}`
					+ `&includeTrashed=1`,
				status: 200,
				headers: {
					"Last-Modified-Version": 15
				},
				json: responseJSON
			});
			
			waitForWindow('chrome://zotero/content/merge.xul', function (dialog) {
				var doc = dialog.document;
				var wizard = doc.documentElement;
				var mergeGroup = wizard.getElementsByTagName('zoteromergegroup')[0];
				
				// 1 (remote)
				// Remote version should be selected by default
				assert.equal(mergeGroup.rightpane.getAttribute('selected'), 'true');
				wizard.getButton('next').click();
				
				// 2 (local)
				assert.equal(mergeGroup.rightpane.getAttribute('selected'), 'true');
				// Select local object
				mergeGroup.leftpane.click();
				assert.equal(mergeGroup.leftpane.getAttribute('selected'), 'true');
				if (Zotero.isMac) {
					assert.isTrue(wizard.getButton('next').hidden);
					assert.isFalse(wizard.getButton('finish').hidden);
				}
				else {
					// TODO
				}
				wizard.getButton('finish').click();
			})
			yield engine._downloadObjects('item', objects.map(o => o.key));
			
			assert.equal(objects[0].getField('title'), values[0].right.title);
			assert.equal(objects[1].getField('title'), values[1].left.title);
			assert.equal(objects[0].getField('version'), values[0].right.version);
			assert.equal(objects[1].getField('version'), values[1].left.version);
			
			var keys = yield Zotero.Sync.Data.Local.getObjectsFromSyncQueue('item', libraryID);
			assert.lengthOf(keys, 0);
		});
		
		it("should resolve all remaining conflicts with one side", function* () {
			var libraryID = Zotero.Libraries.userLibraryID;
			({ engine, client, caller } = yield setup());
			var type = 'item';
			var objects = [];
			var values = [];
			var responseJSON = [];
			var dateAdded = Date.now() - 86400000;
			for (let i = 0; i < 3; i++) {
				values.push({
					left: {},
					right: {}
				});
				
				// Create object in cache
				let obj = objects[i] = yield createDataObject(
					type,
					{
						version: 10,
						dateAdded: Zotero.Date.dateToSQL(new Date(dateAdded), true),
						// Set Date Modified values one minute apart to enforce order
						dateModified: Zotero.Date.dateToSQL(
							new Date(dateAdded + (i * 60000)), true
						)
					}
				);
				let jsonData = obj.toJSON();
				jsonData.key = obj.key;
				jsonData.version = 10;
				let json = {
					key: obj.key,
					version: jsonData.version,
					data: jsonData
				};
				// Save original version in cache
				yield Zotero.Sync.Data.Local.saveCacheObjects(type, libraryID, [json]);
				
				// Create new version in cache, simulating a download
				values[i].right.title = jsonData.title = Zotero.Utilities.randomString();
				values[i].right.version = json.version = jsonData.version = 15;
				responseJSON.push(json);
				
				// Modify object locally
				yield modifyDataObject(obj, undefined, { skipDateModifiedUpdate: true });
				values[i].left.title = obj.getField('title');
				values[i].left.version = obj.getField('version');
			}
			
			setResponse({
				method: "GET",
				url: `users/1/items?format=json&itemKey=${objects.map(o => o.key).join('%2C')}`
					+ `&includeTrashed=1`,
				status: 200,
				headers: {
					"Last-Modified-Version": 15
				},
				json: responseJSON
			});
			
			waitForWindow('chrome://zotero/content/merge.xul', function (dialog) {
				var doc = dialog.document;
				var wizard = doc.documentElement;
				var mergeGroup = wizard.getElementsByTagName('zoteromergegroup')[0];
				var resolveAll = doc.getElementById('resolve-all');
				
				// 1 (remote)
				// Remote version should be selected by default
				assert.equal(mergeGroup.rightpane.getAttribute('selected'), 'true');
				assert.equal(
					resolveAll.label,
					Zotero.getString('sync.conflict.resolveAllRemoteFields')
				);
				wizard.getButton('next').click();
				
				// 2 (local and Resolve All checkbox)
				assert.equal(mergeGroup.rightpane.getAttribute('selected'), 'true');
				mergeGroup.leftpane.click();
				assert.equal(
					resolveAll.label,
					Zotero.getString('sync.conflict.resolveAllLocalFields')
				);
				resolveAll.click();
				
				if (Zotero.isMac) {
					assert.isTrue(wizard.getButton('next').hidden);
					assert.isFalse(wizard.getButton('finish').hidden);
				}
				else {
					// TODO
				}
				wizard.getButton('finish').click();
			})
			yield engine._downloadObjects('item', objects.map(o => o.key));
			
			assert.equal(objects[0].getField('title'), values[0].right.title);
			assert.equal(objects[0].getField('version'), values[0].right.version);
			assert.equal(objects[1].getField('title'), values[1].left.title);
			assert.equal(objects[1].getField('version'), values[1].left.version);
			assert.equal(objects[2].getField('title'), values[2].left.title);
			assert.equal(objects[2].getField('version'), values[2].left.version);
			
			var keys = yield Zotero.Sync.Data.Local.getObjectsFromSyncQueue('item', libraryID);
			assert.lengthOf(keys, 0);
		})
		
		// Note: Conflicts with remote deletions are handled in _startDownload()
		it("should handle local item deletion, keeping deletion", function* () {
			var libraryID = Zotero.Libraries.userLibraryID;
			({ engine, client, caller } = yield setup());
			var type = 'item';
			var objectsClass = Zotero.DataObjectUtilities.getObjectsClassForObjectType(type);
			var responseJSON = [];
			
			// Create object, generate JSON, and delete
			var obj = yield createDataObject(type, { version: 10 });
			var jsonData = obj.toJSON();
			var key = jsonData.key = obj.key;
			jsonData.version = 10;
			let json = {
				key: obj.key,
				version: jsonData.version,
				data: jsonData
			};
			// Delete object locally
			yield obj.eraseTx();
			
			json.version = jsonData.version = 15;
			jsonData.title = Zotero.Utilities.randomString();
			responseJSON.push(json);
			
			setResponse({
				method: "GET",
				url: `users/1/items?format=json&itemKey=${obj.key}&includeTrashed=1`,
				status: 200,
				headers: {
					"Last-Modified-Version": 15
				},
				json: responseJSON
			});
			
			var windowOpened = false;
			waitForWindow('chrome://zotero/content/merge.xul', function (dialog) {
				windowOpened = true;
				
				var doc = dialog.document;
				var wizard = doc.documentElement;
				var mergeGroup = wizard.getElementsByTagName('zoteromergegroup')[0];
				
				// Remote version should be selected by default
				assert.equal(mergeGroup.rightpane.getAttribute('selected'), 'true');
				assert.ok(mergeGroup.leftpane.pane.onclick);
				// Select local deleted version
				mergeGroup.leftpane.pane.click();
				wizard.getButton('finish').click();
			})
			yield engine._downloadObjects('item', [obj.key]);
			assert.isTrue(windowOpened);
			
			obj = objectsClass.getByLibraryAndKey(libraryID, key);
			assert.isFalse(obj);
			
			var keys = yield Zotero.Sync.Data.Local.getObjectsFromSyncQueue('item', libraryID);
			assert.lengthOf(keys, 0);
		})
		
		it("should restore locally deleted item", function* () {
			var libraryID = Zotero.Libraries.userLibraryID;
			({ engine, client, caller } = yield setup());
			var type = 'item';
			var objectsClass = Zotero.DataObjectUtilities.getObjectsClassForObjectType(type);
			var responseJSON = [];
			
			// Create object, generate JSON, and delete
			var obj = yield createDataObject(type, { version: 10 });
			var jsonData = obj.toJSON();
			var key = jsonData.key = obj.key;
			jsonData.version = 10;
			let json = {
				key: obj.key,
				version: jsonData.version,
				data: jsonData
			};
			yield obj.eraseTx();
			
			json.version = jsonData.version = 15;
			jsonData.title = Zotero.Utilities.randomString();
			responseJSON.push(json);
			
			setResponse({
				method: "GET",
				url: `users/1/items?format=json&itemKey=${key}&includeTrashed=1`,
				status: 200,
				headers: {
					"Last-Modified-Version": 15
				},
				json: responseJSON
			});
			
			waitForWindow('chrome://zotero/content/merge.xul', function (dialog) {
				var doc = dialog.document;
				var wizard = doc.documentElement;
				var mergeGroup = wizard.getElementsByTagName('zoteromergegroup')[0];
				
				assert.isTrue(doc.getElementById('resolve-all').hidden);
				
				// Remote version should be selected by default
				assert.equal(mergeGroup.rightpane.getAttribute('selected'), 'true');
				wizard.getButton('finish').click();
			})
			yield engine._downloadObjects('item', [key]);
			
			obj = objectsClass.getByLibraryAndKey(libraryID, key);
			assert.ok(obj);
			assert.equal(obj.getField('title'), jsonData.title);
			
			var keys = yield Zotero.Sync.Data.Local.getObjectsFromSyncQueue('item', libraryID);
			assert.lengthOf(keys, 0);
		})
		
		it("should handle note conflict", function* () {
			var libraryID = Zotero.Libraries.userLibraryID;
			({ engine, client, caller } = yield setup());
			var type = 'item';
			var objectsClass = Zotero.DataObjectUtilities.getObjectsClassForObjectType(type);
			var responseJSON = [];
			
			var noteText1 = "<p>A</p>";
			var noteText2 = "<p>B</p>";
			
			// Create object in cache
			var obj = new Zotero.Item('note');
			obj.setNote("");
			obj.version = 10;
			yield obj.saveTx();
			var jsonData = obj.toJSON();
			var key = jsonData.key = obj.key;
			let json = {
				key: obj.key,
				version: jsonData.version,
				data: jsonData
			};
			yield Zotero.Sync.Data.Local.saveCacheObjects(type, libraryID, [json]);
			
			// Create new version in cache, simulating a download
			json.version = jsonData.version = 15;
			json.data.note = noteText2;
			responseJSON.push(json);
			
			// Modify local version
			obj.setNote(noteText1);
			
			setResponse({
				method: "GET",
				url: `users/1/items?format=json&itemKey=${key}&includeTrashed=1`,
				status: 200,
				headers: {
					"Last-Modified-Version": 15
				},
				json: responseJSON
			});
			
			waitForWindow('chrome://zotero/content/merge.xul', function (dialog) {
				var doc = dialog.document;
				var wizard = doc.documentElement;
				var mergeGroup = wizard.getElementsByTagName('zoteromergegroup')[0];
				
				// Remote version should be selected by default
				assert.equal(mergeGroup.rightpane.getAttribute('selected'), 'true');
				wizard.getButton('finish').click();
			})
			yield engine._downloadObjects('item', [key]);
			
			obj = objectsClass.getByLibraryAndKey(libraryID, key);
			assert.ok(obj);
			assert.equal(obj.getNote(), noteText2);
			
			var keys = yield Zotero.Sync.Data.Local.getObjectsFromSyncQueue('item', libraryID);
			assert.lengthOf(keys, 0);
		})
	});
	
	
	describe("#_upgradeCheck()", function () {
		it("should upgrade a library last synced with the classic sync architecture", function* () {
			var userLibraryID = Zotero.Libraries.userLibraryID;
			({ engine, client, caller } = yield setup());
			
			yield Zotero.Items.erase([1, 2], { skipDeleteLog: true });
			var types = Zotero.DataObjectUtilities.getTypes();
			var objects = {};
			
			// Create objects added before the last classic sync time,
			// which should end up marked as synced
			for (let type of types) {
				objects[type] = [yield createDataObject(type)];
			}
			
			var time1 = "2015-05-01 01:23:45";
			yield Zotero.DB.queryAsync("UPDATE collections SET clientDateModified=?", time1);
			yield Zotero.DB.queryAsync("UPDATE savedSearches SET clientDateModified=?", time1);
			yield Zotero.DB.queryAsync("UPDATE items SET clientDateModified=?", time1);
			
			// Create objects added after the last sync time, which should be ignored and
			// therefore end up marked as unsynced
			for (let type of types) {
				objects[type].push(yield createDataObject(type));
			}
			
			var objectJSON = {};
			for (let type of types) {
				objectJSON[type] = [];
			}
			
			// Create JSON for objects created remotely after the last sync time,
			// which should be ignored
			objectJSON.collection.push(makeCollectionJSON({
				key: Zotero.DataObjectUtilities.generateKey(),
				version: 20,
				name: Zotero.Utilities.randomString()
			}));
			objectJSON.search.push(makeSearchJSON({
				key: Zotero.DataObjectUtilities.generateKey(),
				version: 20,
				name: Zotero.Utilities.randomString()
			}));
			objectJSON.item.push(makeItemJSON({
				key: Zotero.DataObjectUtilities.generateKey(),
				version: 20,
				itemType: "book",
				title: Zotero.Utilities.randomString()
			}));
			
			var lastSyncTime = Zotero.Date.toUnixTimestamp(
				Zotero.Date.sqlToDate("2015-05-02 00:00:00", true)
			);
			yield Zotero.DB.queryAsync(
				"INSERT INTO version VALUES ('lastlocalsync', ?1), ('lastremotesync', ?1)",
				lastSyncTime
			);
			
			var headers = {
				"Last-Modified-Version": 20
			}
			for (let type of types) {
				var suffix = type == 'item' ? '&includeTrashed=1' : '';
				
				var json = {};
				json[objects[type][0].key] = 10;
				json[objectJSON[type][0].key] = objectJSON[type][0].version;
				setResponse({
					method: "GET",
					url: "users/1/" + Zotero.DataObjectUtilities.getObjectTypePlural(type)
						+ "?format=versions" + suffix,
					status: 200,
					headers: headers,
					json: json
				});
				json = {};
				json[objectJSON[type][0].key] = objectJSON[type][0].version;
				setResponse({
					method: "GET",
					url: "users/1/" + Zotero.DataObjectUtilities.getObjectTypePlural(type)
						+ "?format=versions&sincetime=" + lastSyncTime + suffix,
					status: 200,
					headers: headers,
					json: json
				});
			}
			var versionResults = yield engine._upgradeCheck();
			
			// Objects 1 should be marked as synced, with versions from the server
			// Objects 2 should be marked as unsynced
			for (let type of types) {
				var synced = yield Zotero.Sync.Data.Local.getSynced(type, userLibraryID);
				assert.deepEqual(synced, [objects[type][0].key]);
				assert.equal(objects[type][0].version, 10);
				var unsynced = yield Zotero.Sync.Data.Local.getUnsynced(type, userLibraryID);
				assert.deepEqual(unsynced, [objects[type][1].id]);
				
				assert.equal(versionResults[type].libraryVersion, headers["Last-Modified-Version"]);
				assert.property(versionResults[type].versions, objectJSON[type][0].key);
			}
			
			assert.equal(Zotero.Libraries.getVersion(userLibraryID), -1);
		})
	})
	
	describe("#_fullSync()", function () {
		it("should download missing/updated local objects and flag remotely missing local objects for upload", function* () {
			var userLibraryID = Zotero.Libraries.userLibraryID;
			({ engine, client, caller } = yield setup());
			
			var types = Zotero.DataObjectUtilities.getTypes();
			var objects = {};
			var objectJSON = {};
			for (let type of types) {
				objectJSON[type] = [];
			}
			
			for (let type of types) {
				// Create object with outdated version, which should be updated
				let obj = createUnsavedDataObject(type);
				obj.synced = true;
				obj.version = 5;
				yield obj.saveTx();
				objects[type] = [obj];
				
				objectJSON[type].push(makeJSONFunctions[type]({
					key: obj.key,
					version: 20,
					name: Zotero.Utilities.randomString()
				}));
				
				// Create JSON for object that exists remotely and not locally,
				// which should be downloaded
				objectJSON[type].push(makeJSONFunctions[type]({
					key: Zotero.DataObjectUtilities.generateKey(),
					version: 20,
					name: Zotero.Utilities.randomString()
				}));
				
				// Create object marked as synced that doesn't exist remotely,
				// which should be flagged for upload
				obj = createUnsavedDataObject(type);
				obj.synced = true;
				obj.version = 10;
				yield obj.saveTx();
				objects[type].push(obj);
				
				// Create object marked as synced that doesn't exist remotely but is in the
				// remote delete log, which should be deleted locally
				obj = createUnsavedDataObject(type);
				obj.synced = true;
				obj.version = 10;
				yield obj.saveTx();
				objects[type].push(obj);
			}
			
			var headers = {
				"Last-Modified-Version": 20
			}
			setResponse({
				method: "GET",
				url: "users/1/settings",
				status: 200,
				headers: headers,
				json: {
					tagColors: {
						value: [
							{
								name: "A",
								color: "#CC66CC"
							}
						],
						version: 2
					}
				}
			});
			let deletedJSON = {};
			for (let type of types) {
				let suffix = type == 'item' ? '&includeTrashed=1' : '';
				let plural = Zotero.DataObjectUtilities.getObjectTypePlural(type);
				
				var json = {};
				json[objectJSON[type][0].key] = objectJSON[type][0].version;
				json[objectJSON[type][1].key] = objectJSON[type][1].version;
				setResponse({
					method: "GET",
					url: "users/1/" + plural
						+ "?format=versions" + suffix,
					status: 200,
					headers: headers,
					json: json
				});
				
				setResponse({
					method: "GET",
					url: "users/1/" + plural
						+ "?format=json"
						+ "&" + type + "Key=" + objectJSON[type][0].key + "%2C" + objectJSON[type][1].key
						+ suffix,
					status: 200,
					headers: headers,
					json: objectJSON[type]
				});
				
				deletedJSON[plural] = [objects[type][2].key];
			}
			setResponse({
				method: "GET",
				url: "users/1/deleted?since=0",
				status: 200,
				headers: headers,
				json: deletedJSON
			});
			yield engine._fullSync();
			
			// Check settings
			var setting = Zotero.SyncedSettings.get(userLibraryID, "tagColors");
			assert.lengthOf(setting, 1);
			assert.equal(setting[0].name, 'A');
			var settingMetadata = Zotero.SyncedSettings.getMetadata(userLibraryID, "tagColors");
			assert.equal(settingMetadata.version, 2);
			assert.isTrue(settingMetadata.synced);
			
			// Check objects
			for (let type of types) {
				// Objects 1 should be updated with version from server
				assert.equal(objects[type][0].version, 20);
				assert.isTrue(objects[type][0].synced);
				
				// JSON objects 1 should be created locally with version from server
				let objectsClass = Zotero.DataObjectUtilities.getObjectsClassForObjectType(type);
				let obj = objectsClass.getByLibraryAndKey(userLibraryID, objectJSON[type][0].key);
				assert.equal(obj.version, 20);
				assert.isTrue(obj.synced);
				yield assertInCache(obj);
				
				// JSON objects 2 should be marked as unsynced, with their version reset to 0
				assert.equal(objects[type][1].version, 0);
				assert.isFalse(objects[type][1].synced);
				
				// JSON objects 3 should be deleted and not in the delete log
				assert.isFalse(objectsClass.getByLibraryAndKey(userLibraryID, objects[type][2].key));
				assert.isFalse(yield Zotero.Sync.Data.Local.getDateDeleted(
					type, userLibraryID, objects[type][2].key
				));
			}
		})
	})
})
