T5.TileGrid = function(params) {
    // extend the params with the defaults
    params = T5.ex({
        tileSize: T5.tileSize,
        drawGrid: false,
        center: new T5.Vector(),
        gridSize: 25,
        shiftOrigin: null,
        supportFastDraw: true
    }, params);
    
    // initialise tile store related information
    var storage = new Array(Math.pow(params.gridSize, 2)),
        gridSize = params.gridSize,
        tileSize = params.tileSize,
        gridHalfWidth = Math.ceil(params.gridSize >> 1),
        topLeftOffset = T5.V.offset(params.center, -gridHalfWidth),
        lastTileCreator = null,
        tileShift = new T5.Vector(),
        lastNotifyListener = null;    
    
    // initialise varibles
    var halfTileSize = Math.round(params.tileSize / 2),
        invTileSize = params.tileSize ? 1 / params.tileSize : 0,
        active = true,
        tileDrawQueue = null,
        loadedTileCount = 0,
        lastTilesDrawn = false,
        lastCheckOffset = new T5.Vector(),
        shiftDelta = new T5.Vector(),
        repaintDistance = T5.getConfig().repaintDistance,
        reloadTimeout = 0,
        gridHeightWidth = gridSize * params.tileSize,
        tileCols, tileRows, centerPos;
        
    /* internal functions */
        
    function copyStorage(dst, src, delta) {
        // set the length of the destination to match the source
        dst.length = src.length;

        for (var xx = 0; xx < params.gridSize; xx++) {
            for (var yy = 0; yy < params.gridSize; yy++) {
                dst[getTileIndex(xx, yy)] = getTile(xx + delta.x, yy + delta.y);
            } // for
        } // for
    } // copyStorage

    function createTempTile(col, row) {
        var gridXY = getGridXY(col, row);
        return new T5.ImageTile({
            gridX: gridXY.x,
            gridY: gridXY.y
        });
    } // createTempTile
    
    function findTile(matcher) {
        if (! matcher) { return null; }
        
        for (var ii = storage.length; ii--; ) {
            var tile = storage[ii];
            if (tile && matcher(tile)) {
                return tile;
            } // if
        } // for
        
        return null;
    } // findTile
    
    function getGridXY(col, row) {
        return T5.Vector(
            col * tileSize - tileShift.x,
            row * tileSize - tileShift.y);
    } // getGridXY
    
    function getNormalizedPos(col, row) {
        return T5.V.add(new T5.Vector(col, row), T5.V.invert(topLeftOffset), tileShift);
    } // getNormalizedPos
    
    function getShiftDelta(topLeftX, topLeftY, cols, rows) {
        // initialise variables
        var shiftAmount = Math.floor(params.gridSize * 0.2),
            shiftDelta = new T5.Vector();
            
        // test the x
        if (topLeftX < 0 || topLeftX + cols > params.gridSize) {
            shiftDelta.x = topLeftX < 0 ? -shiftAmount : shiftAmount;
        } // if

        // test the y
        if (topLeftY < 0 || topLeftY + rows > params.gridSize) {
            shiftDelta.y = topLeftY < 0 ? -shiftAmount : shiftAmount;
        } // if
        
        return shiftDelta;
    } // getShiftDelta
    
    function getTile(col, row) {
        return (col >= 0 && col < params.gridSize) ? storage[getTileIndex(col, row)] : null;
    } // getTile
    
    function setTile(col, row, tile) {
        storage[getTileIndex(col, row)] = tile;
    } // setTile
    
    function getTileIndex(col, row) {
        return (row * params.gridSize) + col;
    } // getTileIndex
    
    /*
    What a cool function this is.  Basically, this goes through the tile
    grid and creates each of the tiles required at that position of the grid.
    The tileCreator is a callback function that takes a two parameters (col, row) and
    can do whatever it likes but should return a Tile object or null for the specified
    column and row.
    */
    function populate(tileCreator, notifyListener, resetStorage) {
        // take a tick count as we want to time this
        var startTicks = GT.Log.getTraceTicks(),
            tileIndex = 0,
            gridSize = params.gridSize,
            tileSize = params.tileSize,
            centerPos = new T5.Vector(gridSize / 2, gridSize / 2);
            
        // if the storage is to be reset, then do that now
        if (resetStorage) {
            storage = [];
        } // if
        
        if (tileCreator) {
            // GT.Log.info("populating grid, x shift = " + tileShift.x + ", y shift = " + tileShift.y);
            
            for (var row = 0; row < gridSize; row++) {
                for (var col = 0; col < gridSize; col++) {
                    if (! storage[tileIndex]) {
                        var tile = tileCreator(col, row, topLeftOffset, gridSize);
                        
                        // set the tile grid x and grid y position
                        tile.gridX = (col * tileSize) - tileShift.x;
                        tile.gridY = (row * tileSize) - tileShift.y;

                        // add the tile to storage
                        storage[tileIndex] = tile;
                    } // if
                    
                    // increment the tile index
                    tileIndex++;
                } // for
            } // for
        } // if
        
        // save the last tile creator
        lastTileCreator = tileCreator;
        lastNotifyListener = notifyListener;

        // log how long it took
        GT.Log.trace("tile grid populated", startTicks);
        
        // if we have an onpopulate listener defined, let them know
        self.dirty = true;
        self.wakeParent();
    } // populate
    
    function shift(shiftDelta, shiftOriginCallback) {
        // if the shift delta x and the shift delta y are both 0, then return
        if ((shiftDelta.x === 0) && (shiftDelta.y === 0)) { return; }
        
        var ii, startTicks = GT.Log.getTraceTicks();
        // GT.Log.info("need to shift tile store grid, " + shiftDelta.x + " cols and " + shiftDelta.y + " rows.");

        // create new storage
        var newStorage = Array(storage.length);

        // copy the storage from given the various offsets
        copyStorage(newStorage, storage, shiftDelta);

        // update the storage and top left offset
        storage = newStorage;

        // TODO: check whether this is right or not
        if (shiftOriginCallback) {
            topLeftOffset = shiftOriginCallback(topLeftOffset, shiftDelta);
        }
        else {
            topLeftOffset = T5.V.add(topLeftOffset, shiftDelta);
        } // if..else

        // create the tile shift offset
        tileShift.x += (-shiftDelta.x * params.tileSize);
        tileShift.y += (-shiftDelta.y * params.tileSize);
        GT.Log.trace("tile storage shifted", startTicks);

        // populate with the last tile creator (crazy talk)
        populate(lastTileCreator, lastNotifyListener);
    } // shift
    
    function updateDrawQueue(offset, state) {
        if (! centerPos) { return; }
        
        var tile, tmpQueue = [],
            tileStart = new T5.Vector(
                            Math.floor((offset.x + tileShift.x) * invTileSize), 
                            Math.floor((offset.y + tileShift.y) * invTileSize));

        // reset the tile draw queue
        tilesNeeded = false;

        // right, let's draw some tiles (draw rows first)
        for (var yy = tileRows; yy--; ) {
            // iterate through the columns and draw the tiles
            for (var xx = tileCols; xx--; ) {
                // get the tile
                tile = getTile(xx + tileStart.x, yy + tileStart.y);
                var centerDiff = new T5.Vector(xx - centerPos.x, yy - centerPos.y);

                if (! tile) {
                    shiftDelta = getShiftDelta(tileStart.x, tileStart.y, tileCols, tileRows);
                    
                    // TODO: replace the tile with a temporary draw tile here
                    tile = createTempTile(xx + tileStart.x, yy + tileStart.y);
                } // if
                
                // add the tile and position to the tile draw queue
                tmpQueue.push({
                    tile: tile,
                    centerness: T5.V.absSize(centerDiff)
                });
            } // for
        } // for

        // sort the tile queue by "centerness"
        tmpQueue.sort(function(itemA, itemB) {
            return itemB.centerness - itemA.centerness;
        });
        
        if (! tileDrawQueue) {
            tileDrawQueue = new Array(tmpQueue.length);
        } // if
        
        // copy the temporary queue item to the draw queue
        for (var ii = tmpQueue.length; ii--; ) {
            tileDrawQueue[ii] = tmpQueue[ii].tile;
            self.prepTile(tileDrawQueue[ii], state);
        } // for
    } // updateDrawQueue
    
    /* external object definition */
    
    // initialise self
    var self = T5.ex(new T5.ViewLayer(params), {
        gridDimensions: new T5.Dimensions(gridHeightWidth, gridHeightWidth),
        dirty: false,
        
        cycle: function(tickCount, offset, state) {
            var needTiles = shiftDelta.x !== 0 || shiftDelta.y !== 0,
                changeCount = 0;

            if (needTiles) {
                shift(shiftDelta, params.shiftOrigin);

                // reset the delta
                shiftDelta = new T5.Vector();
                
                // things need to happen
                changeCount++;
            } // if
            
            if (state !== T5.viewState('PINCH')) {
                updateDrawQueue(offset, state);
            } // if
            
            // if the grid is dirty let the calling view know
            return changeCount + self.dirty ? 1 : 0;
        },
        
        deactivate: function() {
            active = false;
        },
        
        find: findTile,
        
        prepTile: function(tile, state) {
        },
        
        drawTile: function(context, tile, x, y, state) {
            return false;
        },
        
        // TODO: convert to a configurable implementation
        getTileSize: function() {
            return params.tileSize;
        },
        
        draw: function(context, offset, dimensions, state, view) {
            if (! active) { return; }
            
            // initialise variables
            var startTicks = T5.time(),
                xShift = offset.x,
                yShift = offset.y,
                tilesDrawn = true,
                redraw = view.needRepaint() || (state === T5.viewState('PAN')) || (state === T5.viewState('PINCH')) || T5.isTweening();
                
            if (! centerPos) {
                tileCols = Math.ceil(dimensions.width * invTileSize) + 1;
                tileRows = Math.ceil(dimensions.height * invTileSize) + 1;
                centerPos = new T5.Vector(Math.floor((tileCols-1) / 2), Math.floor((tileRows-1) / 2));
            } // if
            
            // if we don't have a draq queue return
            if (! tileDrawQueue) { return; }
            
            // set the context stroke style for the border
            if (params.drawGrid) {
                context.strokeStyle = "rgba(50, 50, 50, 0.3)";
            } // if
            
            // begin the path for the tile borders
            context.beginPath();

            // iterate through the tiles in the draw queue
            for (var ii = tileDrawQueue.length; ii--; ) {
                var tile = tileDrawQueue[ii];

                // if the tile is loaded, then draw, otherwise load
                if (tile) {
                    var x = tile.gridX - xShift,
                        y = tile.gridY - yShift,
                        drawn = redraw ? false : (! tile.dirty);
                        
                    // draw the tile
                    if (! drawn) {
                        tilesDrawn =  self.drawTile(context, tile, x, y, state) && tilesDrawn;
                        
                        tile.x = x;
                        tile.y = y;
                    } // if
                } 
                else {
                    tilesDrawn = false;
                } // if..else

                // if we are drawing borders, then draw that now
                if (params.drawGrid) {
                    context.rect(x, y, params.tileSize, params.tileSize);
                } // if
            } // for

            // draw the borders if we have them...
            context.stroke();
            GT.Log.trace("drawn tiles", startTicks);
            
            // if the tiles have been drawn and previously haven't then fire the tiles drawn event
            if (tilesDrawn && (! lastTilesDrawn)) {
                view.trigger("tileDrawComplete");
            } // if
            
            // flag the grid as not dirty
            lastTilesDrawn = tilesDrawn;
            self.dirty = false;
        },
        
        getTileAtXY: function(x, y) {
            var queueLength = tileDrawQueue ? tileDrawQueue.length : 0,
                tileSize = params.tileSize;
            
            for (var ii = queueLength; ii--; ) {
                var tile = tileDrawQueue[ii];
                
                if (tile && (x >= tile.x) && (y >= tile.y)) {
                    if ((x <= tile.x + tileSize) && (y <= tile.y + tileSize)) {
                        return tile;
                    } // if
                } // if
            } // for
            
            return null;
        },
        
        getTileVirtualXY: function(col, row, getCenter) {
            // get the normalized position from the tile store
            var pos = getNormalizedPos(col, row),
                fnresult = new T5.Vector(pos.x * params.tileSize, pos.y * params.tileSize);
            
            if (getCenter) {
                fnresult.x += halfTileSize;
                fnresult.y += halfTileSize;
            } // if
            
            return fnresult;
        },
        
        populate: function(tileCreator) {
            populate(tileCreator, null, true);
        }
    });
    
    GT.listen("imagecache.cleared", function(args) {
        // reset all the tiles loaded state
        for (var ii = storage.length; ii--; ) {
            if (storage[ii]) {
                storage[ii].loaded = false;
            } // if
        } // for
    });
    
    GT.listen("tiler.repaint", function(args) {
        for (var ii = storage.length; ii--; ) {
            if (storage[ii]) {
                storage[ii].x = null;
                storage[ii].y = null;
            } // if
        } // for
    });

    return self;
}; // T5.TileGrid

/*

(function() {
    TileStore = function(params) {

        
        
        // initialise self
        var self = {
            setOrigin: function(col, row) {
                if (! tileOrigin) {
                    topLeftOffset = T5.V.offset(new T5.Vector(col, row), -tileHalfWidth);
                }
                else {
                    shiftOrigin(col, row);
                } // if..else
            }
        };
        
        
        return self;
    };
})();

*/
