/**
 * Flipping groups. Upstream flips a group by moving its direct children
 * only, and Arrange > Direction just toggles the group's own flip style, which
 * moves nothing. Here a group is mirrored about its center as a whole: every
 * object inside, at any depth, is moved to its mirrored place and flipped
 * itself, rotations are reversed and line points mirrored, so the result is
 * the group's mirror image. A single object still flips in place.
 */
HmiFlip = function() {};

HmiFlip.install = function()
{
	Graph.prototype.flipChildren = function(cell, horizontal, c)
	{
		HmiFlip.mirrorChildren(this, cell, horizontal, c);
	};

	// Arrange > Direction flips like the Arrange tab's Flip buttons
	var menusInit = Menus.prototype.init;

	Menus.prototype.init = function()
	{
		menusInit.apply(this, arguments);
		var graph = this.editorUi.editor.graph;

		this.put('direction', new Menu(mxUtils.bind(this, function(menu, parent)
		{
			menu.addItem(mxResources.get('flipH'), null, function()
			{
				graph.flipCells(graph.getSelectionCells(), true);
			}, parent);
			menu.addItem(mxResources.get('flipV'), null, function()
			{
				graph.flipCells(graph.getSelectionCells(), false);
			}, parent);
			this.addMenuItems(menu, ['-', 'rotation'], parent);
		})));
	};
};

/** Mirrors the children of cell about c, in cell's coordinates, at every depth. */
HmiFlip.mirrorChildren = function(graph, cell, horizontal, c)
{
	var model = graph.model;
	var key = horizontal ? mxConstants.STYLE_FLIPH : mxConstants.STYLE_FLIPV;

	model.beginUpdate();
	try
	{
		var childCount = model.getChildCount(cell);

		for (var i = 0; i < childCount; i++)
		{
			var child = model.getChildAt(cell, i);

			if (model.isEdge(child))
			{
				graph.flipEdgePoints(child, horizontal, c);
			}
			else if (model.isVertex(child))
			{
				var geo = graph.getCellGeometry(child);

				if (geo != null)
				{
					geo = HmiFlip.mirrorGeometry(geo.clone(), horizontal, c);
					model.setGeometry(child, geo);
					HmiFlip.mirrorChildren(graph, child, horizontal,
						(horizontal ? geo.width : geo.height) / 2);
				}

				// Each its own: toggleCellStyles sets all cells from the first one
				graph.toggleCellStyles(key, false, [child]);
				var rotation = parseFloat(mxUtils.getValue(graph.getCellStyle(child),
					mxConstants.STYLE_ROTATION, 0)) || 0;

				if (rotation != 0)
				{
					graph.setCellStyles(mxConstants.STYLE_ROTATION,
						String((360 - rotation) % 360), [child]);
				}

				graph.setCellStyles('legacyAnchorPoints', '0', [child]);
			}
		}
	}
	finally
	{
		model.endUpdate();
	}
};

/** Moves a child's geometry to its mirrored place about c in its parent. */
HmiFlip.mirrorGeometry = function(geo, horizontal, c)
{
	if (geo.relative)
	{
		// Fractions of the parent, with the offset to the child's corner
		if (horizontal)
		{
			geo.x = 1 - geo.x;

			if (geo.offset != null)
			{
				geo.offset.x = -geo.offset.x - geo.width;
			}
		}
		else
		{
			geo.y = 1 - geo.y;

			if (geo.offset != null)
			{
				geo.offset.y = -geo.offset.y - geo.height;
			}
		}
	}
	else if (horizontal)
	{
		geo.x = 2 * c - geo.x - geo.width;
	}
	else
	{
		geo.y = 2 * c - geo.y - geo.height;
	}

	return geo;
};
