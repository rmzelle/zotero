"use strict";

describe("Zotero.CollectionTreeView", function() {
	var win, zp, cv, userLibraryID;
	
	before(function* () {
		win = yield loadZoteroPane();
		zp = win.ZoteroPane;
		cv = zp.collectionsView;
		userLibraryID = Zotero.Libraries.userLibraryID;
	});
	beforeEach(function () {
		// TODO: Add a selectCollection() function and select a collection instead?
		return selectLibrary(win);
	})
	after(function () {
		win.close();
	});
	
	describe("#refresh()", function () {
		it("should show Duplicate Items and Unfiled Items in My Library by default", function* () {
			Zotero.Prefs.clear('duplicateLibraries');
			Zotero.Prefs.clear('unfiledLibraries');
			yield cv.refresh();
			assert.ok(cv.getRowIndexByID("D" + userLibraryID));
			assert.ok(cv.getRowIndexByID("U" + userLibraryID));
			assert.equal(Zotero.Prefs.get('duplicateLibraries'), "" + userLibraryID);
			assert.equal(Zotero.Prefs.get('unfiledLibraries'), "" + userLibraryID);
		});
		
		it("shouldn't show Duplicate Items and Unfiled Items if hidden", function* () {
			Zotero.Prefs.set('duplicateLibraries', "");
			Zotero.Prefs.set('unfiledLibraries', "");
			yield cv.refresh();
			assert.isFalse(cv.getRowIndexByID("D" + userLibraryID));
			assert.isFalse(cv.getRowIndexByID("U" + userLibraryID));
			assert.strictEqual(Zotero.Prefs.get('duplicateLibraries'), "");
			assert.strictEqual(Zotero.Prefs.get('unfiledLibraries'), "");
		});
	});
	
	describe("collapse/expand", function () {
		it("should close and open My Library repeatedly", function* () {
			yield cv.selectLibrary(userLibraryID);
			var row = cv.selection.currentIndex;
			
			cv.collapseLibrary(userLibraryID);
			var nextRow = cv.getRow(row + 1);
			assert.equal(cv.selection.currentIndex, row);
			assert.ok(nextRow.isSeparator());
			assert.isFalse(cv.isContainerOpen(row));
			
			yield cv.expandLibrary(userLibraryID);
			nextRow = cv.getRow(row + 1);
			assert.equal(cv.selection.currentIndex, row);
			assert.ok(!nextRow.isSeparator());
			assert.ok(cv.isContainerOpen(row));
			
			cv.collapseLibrary(userLibraryID);
			nextRow = cv.getRow(row + 1);
			assert.equal(cv.selection.currentIndex, row);
			assert.ok(nextRow.isSeparator());
			assert.isFalse(cv.isContainerOpen(row));
			
			yield cv.expandLibrary(userLibraryID);
			nextRow = cv.getRow(row + 1);
			assert.equal(cv.selection.currentIndex, row);
			assert.ok(!nextRow.isSeparator());
			assert.ok(cv.isContainerOpen(row));
		})
	})
	
	describe("#expandLibrary()", function () {
		var libraryRow, col1, col2, col3;
		
		before(function* () {
			yield cv.selectLibrary(userLibraryID);
			libraryRow = cv.selection.currentIndex;
		});
		
		beforeEach(function* () {
			// My Library
			//   - A
			//     - B
			//       - C
			col1 = yield createDataObject('collection');
			col2 = yield createDataObject('collection', { parentID: col1.id });
			col3 = yield createDataObject('collection', { parentID: col2.id });
		});
		
		it("should open a library and respect stored container state", function* () {
			// Collapse B
			yield cv.toggleOpenState(cv.getRowIndexByID(col2.treeViewID));
			yield cv._rememberOpenStates();
			
			// Close and reopen library
			yield cv.toggleOpenState(libraryRow);
			yield cv.expandLibrary(userLibraryID);
			
			assert.ok(cv.getRowIndexByID(col1.treeViewID))
			assert.ok(cv.getRowIndexByID(col2.treeViewID))
			assert.isFalse(cv.getRowIndexByID(col3.treeViewID))
		});
		
		it("should open a library and all subcollections in recursive mode", function* () {
			yield cv.toggleOpenState(cv.getRowIndexByID(col2.treeViewID));
			yield cv._rememberOpenStates();
			
			// Close and reopen library
			yield cv.toggleOpenState(libraryRow);
			yield cv.expandLibrary(userLibraryID, true);
			
			assert.ok(cv.getRowIndexByID(col1.treeViewID))
			assert.ok(cv.getRowIndexByID(col2.treeViewID))
			assert.ok(cv.getRowIndexByID(col3.treeViewID))
		});
	});
	
	describe("#expandToCollection()", function () {
		it("should expand a collection to a subcollection", function* () {
			var collection1 = yield createDataObject('collection');
			var collection2 = createUnsavedDataObject('collection');
			collection2.parentID = collection1.id;
			yield collection2.saveTx({
				skipSelect: true
			});
			var row = cv.getRowIndexByID("C" + collection1.id);
			assert.isFalse(cv.isContainerOpen(row));
			
			yield cv.expandToCollection(collection2.id);
			
			// Make sure parent row position hasn't changed
			assert.equal(cv.getRowIndexByID("C" + collection1.id), row);
			// Parent should have been opened
			assert.isTrue(cv.isContainerOpen(row));
		})
	})
	
	describe("#selectByID()", function () {
		it("should select the trash", function* () {
			yield cv.selectByID("T1");
			var row = cv.selection.currentIndex;
			var treeRow = cv.getRow(row);
			assert.ok(treeRow.isTrash());
			assert.equal(treeRow.ref.libraryID, userLibraryID);
		})
	})
	
	describe("#selectWait()", function () {
		it("shouldn't hang if row is already selected", function* () {
			var row = cv.getRowIndexByID("T" + userLibraryID);
			cv.selection.select(row);
			yield Zotero.Promise.delay(50);
			yield cv.selectWait(row);
		})
	})
	
	describe("#notify()", function () {
		it("should select a new collection", function* () {
			// Create collection
			var collection = new Zotero.Collection;
			collection.name = "Select new collection";
			var id = yield collection.saveTx();
			
			// New collection should be selected
			var selected = cv.getSelectedCollection(true);
			assert.equal(selected, id);
		});
		
		it("shouldn't select a new collection if skipNotifier is passed", function* () {
			// Create collection with skipNotifier flag
			var collection = new Zotero.Collection;
			collection.name = "No select on skipNotifier";
			var id = yield collection.saveTx({
				skipNotifier: true
			});
			
			// Library should still be selected
			assert.equal(cv.getSelectedLibraryID(), userLibraryID);
		});
		
		it("shouldn't select a new collection if skipSelect is passed", function* () {
			// Create collection with skipSelect flag
			var collection = new Zotero.Collection;
			collection.name = "No select on skipSelect";
			var id = yield collection.saveTx({
				skipSelect: true
			});
			
			// Library should still be selected
			assert.equal(cv.getSelectedLibraryID(), userLibraryID);
		});
		
		it("shouldn't select a modified collection", function* () {
			// Create collection
			var collection = new Zotero.Collection;
			collection.name = "No select on modify";
			var id = yield collection.saveTx();
			
			yield selectLibrary(win);
			
			collection.name = "No select on modify 2";
			yield collection.saveTx();
			
			// Modified collection should not be selected
			assert.equal(cv.getSelectedLibraryID(), userLibraryID);
		});
		
		it("should maintain selection on a selected modified collection", function* () {
			// Create collection
			var collection = new Zotero.Collection;
			collection.name = "Reselect on modify";
			var id = yield collection.saveTx();
			
			var selected = cv.getSelectedCollection(true);
			assert.equal(selected, id);
			
			collection.name = "Reselect on modify 2";
			yield collection.saveTx();
			
			// Modified collection should still be selected
			selected = cv.getSelectedCollection(true);
			assert.equal(selected, id);
		});
		
		it("should update the editability of the current view", function* () {
			var group = yield createGroup({
				editable: false,
				filesEditable: false
			});
			yield cv.selectLibrary(group.libraryID);
			yield waitForItemsLoad(win);
			
			assert.isFalse(cv.selectedTreeRow.editable);
			var cmd = win.document.getElementById('cmd_zotero_newStandaloneNote');
			assert.isTrue(cmd.getAttribute('disabled') == 'true');
			
			group.editable = true;
			yield group.saveTx();
			
			assert.isTrue(cv.selectedTreeRow.editable);
			assert.isFalse(cmd.getAttribute('disabled') == 'true');
		});
		
		it("should re-sort a modified collection", function* () {
			var prefix = Zotero.Utilities.randomString() + " ";
			var collectionA = yield createDataObject('collection', { name: prefix + "A" });
			var collectionB = yield createDataObject('collection', { name: prefix + "B" });
			
			var aRow = cv.getRowIndexByID("C" + collectionA.id);
			var aRowOriginal = aRow;
			var bRow = cv.getRowIndexByID("C" + collectionB.id);
			assert.equal(bRow, aRow + 1);
			
			collectionA.name = prefix + "C";
			yield collectionA.saveTx();
			
			var aRow = cv.getRowIndexByID("C" + collectionA.id);
			var bRow = cv.getRowIndexByID("C" + collectionB.id);
			assert.equal(bRow, aRowOriginal);
			assert.equal(aRow, bRow + 1);
		})
		
		it("should re-sort a modified search", function* () {
			var prefix = Zotero.Utilities.randomString() + " ";
			var searchA = yield createDataObject('search', { name: prefix + "A" });
			var searchB = yield createDataObject('search', { name: prefix + "B" });
			
			var aRow = cv.getRowIndexByID("S" + searchA.id);
			var aRowOriginal = aRow;
			var bRow = cv.getRowIndexByID("S" + searchB.id);
			assert.equal(bRow, aRow + 1);
			
			searchA.name = prefix + "C";
			yield searchA.saveTx();
			
			var aRow = cv.getRowIndexByID("S" + searchA.id);
			var bRow = cv.getRowIndexByID("S" + searchB.id);
			assert.equal(bRow, aRowOriginal);
			assert.equal(aRow, bRow + 1);
		})
		
		
		it("should add multiple collections", function* () {
			var col1, col2;
			yield Zotero.DB.executeTransaction(function* () {
				col1 = createUnsavedDataObject('collection');
				col2 = createUnsavedDataObject('collection');
				yield col1.save();
				yield col2.save();
			});
			
			var aRow = cv.getRowIndexByID("C" + col1.id);
			var bRow = cv.getRowIndexByID("C" + col2.id);
			assert.isAbove(aRow, 0);
			assert.isAbove(bRow, 0);
			// skipSelect is implied for multiple collections, so library should still be selected
			assert.equal(cv.selection.currentIndex, 0);
		});
		
		
		it("shouldn't refresh the items list when a collection is modified", function* () {
			var collection = yield createDataObject('collection');
			yield waitForItemsLoad(win);
			var itemsView = zp.itemsView;
			
			collection.name = "New Name";
			yield collection.saveTx();
			
			yield waitForItemsLoad(win);
			assert.equal(zp.itemsView, itemsView);
		})
		
		it("should add a saved search after collections", function* () {
			var collection = new Zotero.Collection;
			collection.name = "Test";
			var collectionID = yield collection.saveTx();
			
			var search = new Zotero.Search;
			search.name = "A Test Search";
			search.addCondition('title', 'contains', 'test');
			var searchID = yield search.saveTx();
			
			var collectionRow = cv._rowMap["C" + collectionID];
			var searchRow = cv._rowMap["S" + searchID];
			var duplicatesRow = cv._rowMap["D" + userLibraryID];
			var unfiledRow = cv._rowMap["U" + userLibraryID];
			
			assert.isAbove(searchRow, collectionRow);
			// If there's a duplicates row or an unfiled row, add before those.
			// Otherwise, add before the trash
			if (duplicatesRow !== undefined) {
				assert.isBelow(searchRow, duplicatesRow);
			}
			else if (unfiledRow !== undefined) {
				assert.isBelow(searchRow, unfiledRow);
			}
			else {
				var trashRow = cv._rowMap["T" + userLibraryID];
				assert.isBelow(searchRow, trashRow);
			}
		})
		
		it("shouldn't select a new group", function* () {
			var group = yield createGroup();
			// Library should still be selected
			assert.equal(cv.getSelectedLibraryID(), userLibraryID);
		})
		
		it("should remove a group and all children", function* () {
			// Make sure Group Libraries separator and header exist already,
			// since otherwise they'll interfere with the count
			yield getGroup();
			
			var originalRowCount = cv.rowCount;
			
			var group = yield createGroup();
			yield createDataObject('collection', { libraryID: group.libraryID });
			var c = yield createDataObject('collection', { libraryID: group.libraryID });
			yield createDataObject('collection', { libraryID: group.libraryID, parentID: c.id });
			yield createDataObject('collection', { libraryID: group.libraryID });
			yield createDataObject('collection', { libraryID: group.libraryID });
			
			// Group, collections, and trash
			assert.equal(cv.rowCount, originalRowCount + 7);
			
			var spy = sinon.spy(cv, "refresh");
			try {
				yield group.eraseTx();
				
				assert.equal(cv.rowCount, originalRowCount);
				// Make sure the tree wasn't refreshed
				sinon.assert.notCalled(spy);
			}
			finally {
				spy.restore();
			}
		})
		
		it("should select a new feed", function* () {
			var feed = yield createFeed();
			// Library should still be selected
			assert.equal(cv.getSelectedLibraryID(), feed.id);
		})
		
	})
	
	describe("#drop()", function () {
		/**
		 * Simulate a drag and drop
		 *
		 * @param {String} type - 'item' or 'collection'
		 * @param {String|Object} targetRow - Tree row id (e.g., "L123"), or { row, orient }
		 * @param {Integer[]} collectionIDs
		 * @param {Promise} [promise] - If a promise is provided, it will be waited for and its
		 *     value returned after the drag. Otherwise, an 'add' event will be waited for, and
		 *     an object with 'ids' and 'extraData' will be returned.
		 */
		var drop = Zotero.Promise.coroutine(function* (objectType, targetRow, ids, promise) {
			if (typeof targetRow == 'string') {
				var row = cv.getRowIndexByID(targetRow);
				var orient = 0;
			}
			else {
				var { row, orient } = targetRow;
			}
			
			var stub = sinon.stub(Zotero.DragDrop, "getDragTarget");
			stub.returns(cv.getRow(row));
			if (!promise) {
				promise = waitForNotifierEvent("add", objectType);
			}
			yield cv.drop(row, orient, {
				dropEffect: 'copy',
				effectAllowed: 'copy',
				mozSourceNode: win.document.getElementById(`zotero-${objectType}s-tree`),
				types: {
					contains: function (type) {
						return type == `zotero/${objectType}`;
					}
				},
				getData: function (type) {
					if (type == `zotero/${objectType}`) {
						return ids.join(",");
					}
				}
			});
			
			// Add observer to wait for add
			var result = yield promise;
			stub.restore();
			return result;
		});
		
		
		var canDrop = Zotero.Promise.coroutine(function* (type, targetRowID, ids) {
			var row = cv.getRowIndexByID(targetRowID);
			
			var stub = sinon.stub(Zotero.DragDrop, "getDragTarget");
			stub.returns(cv.getRow(row));
			var dt = {
				dropEffect: 'copy',
				effectAllowed: 'copy',
				mozSourceNode: win.document.getElementById(`zotero-${type}s-tree`),
				types: {
					contains: function (type) {
						return type == `zotero/${type}`;
					}
				},
				getData: function (type) {
					if (type == `zotero/${type}`) {
						return ids.join(",");
					}
				}
			};
			var canDrop = cv.canDropCheck(row, 0, dt);
			if (canDrop) {
				canDrop = yield cv.canDropCheckAsync(row, 0, dt);
			}
			stub.restore();
			return canDrop;
		});
		
		describe("with items", function () {
			it("should add an item to a collection", function* () {
				var collection = yield createDataObject('collection', false, { skipSelect: true });
				var item = yield createDataObject('item', false, { skipSelect: true });
				
				// Add observer to wait for collection add
				var deferred = Zotero.Promise.defer();
				var observerID = Zotero.Notifier.registerObserver({
					notify: function (event, type, ids, extraData) {
						if (type == 'collection-item' && event == 'add'
								&& ids[0] == collection.id + "-" + item.id) {
							setTimeout(function () {
								deferred.resolve();
							});
						}
					}
				}, 'collection-item', 'test');
				
				yield drop('item', 'C' + collection.id, [item.id], deferred.promise);
				
				Zotero.Notifier.unregisterObserver(observerID);
				
				yield cv.selectCollection(collection.id);
				yield waitForItemsLoad(win);
				
				var itemsView = win.ZoteroPane.itemsView
				assert.equal(itemsView.rowCount, 1);
				var treeRow = itemsView.getRow(0);
				assert.equal(treeRow.ref.id, item.id);
			})
			
			it("should copy an item with an attachment to a group", function* () {
				var group = yield createGroup();
				
				var item = yield createDataObject('item', false, { skipSelect: true });
				var file = getTestDataDirectory();
				file.append('test.png');
				var attachment = yield Zotero.Attachments.importFromFile({
					file: file,
					parentItemID: item.id
				});
				
				var ids = (yield drop('item', 'L' + group.libraryID, [item.id])).ids;
				
				yield cv.selectLibrary(group.libraryID);
				yield waitForItemsLoad(win);
				
				// Check parent
				var itemsView = win.ZoteroPane.itemsView;
				assert.equal(itemsView.rowCount, 1);
				var treeRow = itemsView.getRow(0);
				assert.equal(treeRow.ref.libraryID, group.libraryID);
				assert.equal(treeRow.ref.id, ids[0]);
				// New item should link back to original
				var linked = item.getLinkedItem(group.libraryID);
				assert.equal(linked.id, treeRow.ref.id);
				
				// Check attachment
				assert.isTrue(itemsView.isContainer(0));
				itemsView.toggleOpenState(0);
				assert.equal(itemsView.rowCount, 2);
				treeRow = itemsView.getRow(1);
				assert.equal(treeRow.ref.id, ids[1]);
				// New attachment should link back to original
				linked = attachment.getLinkedItem(group.libraryID);
				assert.equal(linked.id, treeRow.ref.id);
				
				return group.eraseTx();
			})
			
			it("should not copy an item or its attachment to a group twice", function* () {
				var group = yield getGroup();
				
				var itemTitle = Zotero.Utilities.randomString();
				var item = yield createDataObject('item', false, { skipSelect: true });
				var file = getTestDataDirectory();
				file.append('test.png');
				var attachment = yield Zotero.Attachments.importFromFile({
					file: file,
					parentItemID: item.id
				});
				var attachmentTitle = Zotero.Utilities.randomString();
				attachment.setField('title', attachmentTitle);
				yield attachment.saveTx();
				
				yield drop('item', 'L' + group.libraryID, [item.id]);
				assert.isFalse(yield canDrop('item', 'L' + group.libraryID, [item.id]));
			})
			
			it("should remove a linked, trashed item in a group from the trash and collections", function* () {
				var group = yield getGroup();
				var collection = yield createDataObject('collection', { libraryID: group.libraryID });
				
				var item = yield createDataObject('item', false, { skipSelect: true });
				yield drop('item', 'L' + group.libraryID, [item.id]);
				
				var droppedItem = item.getLinkedItem(group.libraryID);
				droppedItem.setCollections([collection.id]);
				droppedItem.deleted = true;
				yield droppedItem.saveTx();
				
				// Add observer to wait for collection add
				var deferred = Zotero.Promise.defer();
				var observerID = Zotero.Notifier.registerObserver({
					notify: function (event, type, ids) {
						if (event == 'refresh' && type == 'trash' && ids[0] == group.libraryID) {
							setTimeout(function () {
								deferred.resolve();
							});
						}
					}
				}, 'trash', 'test');
				yield drop('item', 'L' + group.libraryID, [item.id], deferred.promise);
				Zotero.Notifier.unregisterObserver(observerID);
				
				assert.isFalse(droppedItem.deleted);
				// Should be removed from collections when removed from trash
				assert.lengthOf(droppedItem.getCollections(), 0);
			})
		})
		
		
		describe("with collections", function () {
			it("should make a subcollection top-level", function* () {
				var collection1 = yield createDataObject('collection', { name: "A" }, { skipSelect: true });
				var collection2 = yield createDataObject('collection', { name: "C" }, { skipSelect: true });
				var collection3 = yield createDataObject('collection', { name: "D" }, { skipSelect: true });
				var collection4 = yield createDataObject('collection', { name: "B", parentKey: collection2.key });
				
				var colIndex1 = cv.getRowIndexByID('C' + collection1.id);
				var colIndex2 = cv.getRowIndexByID('C' + collection2.id);
				var colIndex3 = cv.getRowIndexByID('C' + collection3.id);
				var colIndex4 = cv.getRowIndexByID('C' + collection4.id);
				
				// Add observer to wait for collection add
				var deferred = Zotero.Promise.defer();
				var observerID = Zotero.Notifier.registerObserver({
					notify: function (event, type, ids, extraData) {
						if (type == 'collection' && event == 'modify' && ids[0] == collection4.id) {
							setTimeout(function () {
								deferred.resolve();
							}, 50);
						}
					}
				}, 'collection', 'test');
				
				yield drop(
					'collection',
					{
						row: 0,
						orient: 1
					},
					[collection4.id],
					deferred.promise
				);
				
				Zotero.Notifier.unregisterObserver(observerID);
				
				var newColIndex1 = cv.getRowIndexByID('C' + collection1.id);
				var newColIndex2 = cv.getRowIndexByID('C' + collection2.id);
				var newColIndex3 = cv.getRowIndexByID('C' + collection3.id);
				var newColIndex4 = cv.getRowIndexByID('C' + collection4.id);
				
				assert.equal(newColIndex1, colIndex1);
				assert.isBelow(newColIndex4, newColIndex2);
				assert.isBelow(newColIndex2, newColIndex3);
				assert.equal(cv.getRow(newColIndex4).level, cv.getRow(newColIndex1).level);
			})
			                                                                                         
			it("should move a subcollection and its subcollection down under another collection", function* () {
				var collectionA = yield createDataObject('collection', { name: "A" }, { skipSelect: true });
				var collectionB = yield createDataObject('collection', { name: "B", parentKey: collectionA.key });
				var collectionC = yield createDataObject('collection', { name: "C", parentKey: collectionB.key });
				var collectionD = yield createDataObject('collection', { name: "D" }, { skipSelect: true });
				var collectionE = yield createDataObject('collection', { name: "E" }, { skipSelect: true });
				var collectionF = yield createDataObject('collection', { name: "F" }, { skipSelect: true });
				var collectionG = yield createDataObject('collection', { name: "G", parentKey: collectionD.key });
				var collectionH = yield createDataObject('collection', { name: "H", parentKey: collectionG.key });
				
				var colIndexA = cv.getRowIndexByID('C' + collectionA.id);
				var colIndexB = cv.getRowIndexByID('C' + collectionB.id);
				var colIndexC = cv.getRowIndexByID('C' + collectionC.id);
				var colIndexD = cv.getRowIndexByID('C' + collectionD.id);
				var colIndexE = cv.getRowIndexByID('C' + collectionE.id);
				var colIndexF = cv.getRowIndexByID('C' + collectionF.id);
				var colIndexG = cv.getRowIndexByID('C' + collectionG.id);
				var colIndexH = cv.getRowIndexByID('C' + collectionH.id);
				
				yield cv.selectCollection(collectionG.id);                                                 
				
				// Add observer to wait for collection add
				var deferred = Zotero.Promise.defer();                                                                          
				var observerID = Zotero.Notifier.registerObserver({
					notify: function (event, type, ids, extraData) {
						if (type == 'collection' && event == 'modify' && ids[0] == collectionG.id) {
							setTimeout(function () {
								deferred.resolve();
							}, 50);
						}
					}
				}, 'collection', 'test');
				
				yield drop(
					'collection',
					{
						row: colIndexE,
						orient: 0
					},
					[collectionG.id],
					deferred.promise
				);
				
				Zotero.Notifier.unregisterObserver(observerID);
				
				var newColIndexA = cv.getRowIndexByID('C' + collectionA.id);
				var newColIndexB = cv.getRowIndexByID('C' + collectionB.id);
				var newColIndexC = cv.getRowIndexByID('C' + collectionC.id);
				var newColIndexD = cv.getRowIndexByID('C' + collectionD.id);
				var newColIndexE = cv.getRowIndexByID('C' + collectionE.id);
				var newColIndexF = cv.getRowIndexByID('C' + collectionF.id);
				var newColIndexG = cv.getRowIndexByID('C' + collectionG.id);
				var newColIndexH = cv.getRowIndexByID('C' + collectionH.id);
				
				assert.isFalse(cv.isContainerOpen(newColIndexD));
				assert.isTrue(cv.isContainerEmpty(newColIndexD));
				assert.isTrue(cv.isContainerOpen(newColIndexE));
				assert.isFalse(cv.isContainerEmpty(newColIndexE));
				assert.equal(newColIndexE, newColIndexG - 1);
				assert.equal(newColIndexG, newColIndexH - 1);
				
				// TODO: Check deeper subcollection open states
			})
				
			it("should move a subcollection and its subcollection up under another collection", function* () {
				var collectionA = yield createDataObject('collection', { name: "A" }, { skipSelect: true });
				var collectionB = yield createDataObject('collection', { name: "B", parentKey: collectionA.key });
				var collectionC = yield createDataObject('collection', { name: "C", parentKey: collectionB.key });
				var collectionD = yield createDataObject('collection', { name: "D" }, { skipSelect: true });
				var collectionE = yield createDataObject('collection', { name: "E" }, { skipSelect: true });
				var collectionF = yield createDataObject('collection', { name: "F" }, { skipSelect: true });
				var collectionG = yield createDataObject('collection', { name: "G", parentKey: collectionE.key });
				var collectionH = yield createDataObject('collection', { name: "H", parentKey: collectionG.key });
				
				var colIndexA = cv.getRowIndexByID('C' + collectionA.id);
				var colIndexB = cv.getRowIndexByID('C' + collectionB.id);
				var colIndexC = cv.getRowIndexByID('C' + collectionC.id);
				var colIndexD = cv.getRowIndexByID('C' + collectionD.id);
				var colIndexE = cv.getRowIndexByID('C' + collectionE.id);
				var colIndexF = cv.getRowIndexByID('C' + collectionF.id);
				var colIndexG = cv.getRowIndexByID('C' + collectionG.id);
				var colIndexH = cv.getRowIndexByID('C' + collectionH.id);
				
				yield cv.selectCollection(collectionG.id);
				
				// Add observer to wait for collection add
				var deferred = Zotero.Promise.defer();
				var observerID = Zotero.Notifier.registerObserver({
					notify: function (event, type, ids, extraData) {
						if (type == 'collection' && event == 'modify' && ids[0] == collectionG.id) {
							setTimeout(function () {
								deferred.resolve();
							}, 50);
						}
					}
				}, 'collection', 'test');
				
				yield drop(
					'collection',
					{
						row: colIndexD,
						orient: 0
					},
					[collectionG.id],
					deferred.promise
				);
				
				Zotero.Notifier.unregisterObserver(observerID);
				
				var newColIndexA = cv.getRowIndexByID('C' + collectionA.id);
				var newColIndexB = cv.getRowIndexByID('C' + collectionB.id);
				var newColIndexC = cv.getRowIndexByID('C' + collectionC.id);
				var newColIndexD = cv.getRowIndexByID('C' + collectionD.id);
				var newColIndexE = cv.getRowIndexByID('C' + collectionE.id);
				var newColIndexF = cv.getRowIndexByID('C' + collectionF.id);
				var newColIndexG = cv.getRowIndexByID('C' + collectionG.id);
				var newColIndexH = cv.getRowIndexByID('C' + collectionH.id);
				
				assert.isFalse(cv.isContainerOpen(newColIndexE));
				assert.isTrue(cv.isContainerEmpty(newColIndexE));
				assert.isTrue(cv.isContainerOpen(newColIndexD));
				assert.isFalse(cv.isContainerEmpty(newColIndexD));
				assert.equal(newColIndexD, newColIndexG - 1);
				assert.equal(newColIndexG, newColIndexH - 1);
				
				// TODO: Check deeper subcollection open states
			})
		})


		describe("with feed items", function () {
			it('should add a translated feed item recovered from an URL', function* (){
				var feed = yield createFeed();
				var collection = yield createDataObject('collection', false, { skipSelect: true });
				var url = getTestDataUrl('metadata/journalArticle-single.html');
				var feedItem = yield createDataObject('feedItem', {libraryID: feed.libraryID}, { skipSelect: true });
				feedItem.setField('url', url);
				yield feedItem.saveTx();
				var translateFn = sinon.spy(feedItem, 'translate');
				
				// Add observer to wait for collection add
				var deferred = Zotero.Promise.defer();
				var itemIds;

				var ids = (yield drop('item', 'C' + collection.id, [feedItem.id])).ids;
				
				// Check that the translated item was the one that was created after drag
				var item;
				yield translateFn.returnValues[0].then(function(i) {
					item = i;
					assert.equal(item.id, ids[0]);
				});
				
				yield cv.selectCollection(collection.id);
				yield waitForItemsLoad(win);
				
				var itemsView = win.ZoteroPane.itemsView;
				assert.equal(itemsView.rowCount, 1);
				var treeRow = itemsView.getRow(0);
				assert.equal(treeRow.ref.id, item.id);
			})
		})
	})
})
