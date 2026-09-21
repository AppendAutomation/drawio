/**
 * Persistence of the HMI project inside the .drawio-hmi file.
 *
 * Upstream's EditorUi.getXmlFileData rebuilds the <mxfile> element with a
 * SHALLOW clone and then re-appends only the <diagram> children, so a custom
 * child element is dropped on every save. Attributes on <mxfile> survive that
 * clone. This file exploits both halves of that asymmetry:
 *
 *   - <hmiProject> carries the dictionary, re-appended after upstream is done;
 *   - hmiVersion is an attribute, so it survives even a save by an editor that
 *     knows nothing about us.
 *
 * Their disagreement on load is therefore a reliable detector for "this file
 * was round-tripped through stock drawio and the dictionary was eaten", which
 * is the difference between a clear error and every animation silently going
 * dead.
 */
HmiFile = function() {};

HmiFile.VERSION_ATTRIBUTE = 'hmiVersion';
HmiFile.ELEMENT = 'hmiProject';
HmiFile.EXTENSION = '.drawio-hmi';

HmiFile.install = function()
{
	// ------------------------------------------------------------ saving

	var editorUiGetXmlFileData = EditorUi.prototype.getXmlFileData;

	EditorUi.prototype.getXmlFileData = function(ignoreSelection, currentPage,
		uncompressed, resolveReferences)
	{
		var node = editorUiGetXmlFileData.apply(this, arguments);

		HmiLog.guard('getXmlFileData', mxUtils.bind(this, function()
		{
			// A selection-only export returns an mxGraphModel, not an mxfile;
			// the dictionary has no place in that.
			if (node == null || node.nodeName !== 'mxfile' ||
				this.hmiProject == null || this.hmiProject.isEmpty())
			{
				return;
			}

			node.setAttribute(HmiFile.VERSION_ATTRIBUTE, HmiProject.FORMAT_VERSION);

			// Defensive: upstream builds a fresh node each call, but if that
			// ever changes we must not append a second copy.
			var existing = node.getElementsByTagName(HmiFile.ELEMENT);

			while (existing.length > 0)
			{
				existing[0].parentNode.removeChild(existing[0]);
			}

			node.appendChild(this.hmiProject.toXml(node.ownerDocument));
		}));

		return node;
	};

	// ----------------------------------------------------------- loading

	var editorUiSetFileData = EditorUi.prototype.setFileData;

	EditorUi.prototype.setFileData = function(data, file)
	{
		editorUiSetFileData.apply(this, arguments);

		HmiLog.guard('setFileData', mxUtils.bind(this, function()
		{
			var root = this.fileNode;
			var declared = (root != null) ?
				root.getAttribute(HmiFile.VERSION_ATTRIBUTE) : null;
			var nodes = (root != null) ?
				root.getElementsByTagName(HmiFile.ELEMENT) : [];

			if (nodes.length > 0)
			{
				this.hmiProject = HmiProject.fromXml(nodes[0]);
			}
			else if (declared != null)
			{
				// The marker survived but the payload did not.
				this.hmiProject = new HmiProject();
				HmiLog.warn('tag dictionary missing though hmiVersion=' + declared);

				this.showError(mxResources.get('error'),
					mxResources.get('hmiDictionaryLost'));
			}
			else
			{
				this.hmiProject = HmiFile.createDefaultProject();
			}
		}));
	};

	// -------------------------------------------------- save dialog filter
	// diagramFileTypes is declarative and feeds createFileSystemFilters, so
	// prepending an entry is all the Save As dialog needs.

	if (Editor.prototype.diagramFileTypes != null)
	{
		Editor.prototype.diagramFileTypes = [{
			description: 'hmiFileType',
			extension: 'drawio-hmi',
			mimeType: 'text/xml'
		}].concat(Editor.prototype.diagramFileTypes);
	}

	HmiFile.installOpenFilter();
};

/**
 * Adds .drawio-hmi to the open dialog.
 *
 * App.pickFile hardcodes its filter list inline, so rather than replacing that
 * whole function (and inheriting every future upstream change to it) we
 * intercept the request on its way to the main process and rewrite the
 * filters. Eight lines instead of fifty, and it keeps working if pickFile is
 * rewritten upstream.
 */
HmiFile.installOpenFilter = function()
{
	if (typeof electron === 'undefined' || electron == null ||
		electron.request == null)
	{
		return;
	}

	var origRequest = electron.request;

	electron.request = function(msg, callback, error)
	{
		HmiLog.guard('openFilter', function()
		{
			if (msg != null && msg.action === 'showOpenDialog' &&
				msg.filters != null)
			{
				msg.filters = HmiFile.withHmiFilter(msg.filters);
			}
		});

		return origRequest.apply(this, arguments);
	};
};

HmiFile.withHmiFilter = function(filters)
{
	for (var i = 0; i < filters.length; i++)
	{
		var ext = filters[i].extensions;

		if (ext != null && mxUtils.indexOf(ext, 'drawio') >= 0 &&
			mxUtils.indexOf(ext, 'drawio-hmi') < 0)
		{
			// Copy rather than mutate: the array upstream passed may be shared.
			filters[i] = {
				name: filters[i].name,
				extensions: ['drawio-hmi'].concat(ext)
			};
		}
	}

	return filters;
};

/**
 * A new project gets one simulator access name so that the driver model is
 * exercised from the first tag the user creates.
 */
HmiFile.createDefaultProject = function()
{
	var project = new HmiProject();

	project.accessNames.push({
		id: 'PLC1', driver: 'simulator', node: '', topic: '', rateMs: 250
	});

	return project;
};
