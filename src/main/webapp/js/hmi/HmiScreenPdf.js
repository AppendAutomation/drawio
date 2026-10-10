/**
 * ScreenToPDF(): saves the screen as the operator sees it, popups included,
 * as a PDF: one landscape Letter page with the screen fitted, centered and
 * at least a quarter inch from every edge. Like RecipeExport it returns 1
 * once the Save dialog is on its way and the script carries on; where the
 * file went, or why it could not be written, comes later (the log, or the
 * function error window).
 *
 * The screen's own elements are drawn onto a canvas at its design size, so
 * the page is sharp however small the screen is shown, and the editor's
 * dialogs and menus stay out of it. The desktop apps save through the OS
 * dialog, and fall back to capturing the window in the main process when
 * the screen shows pictures that are not embedded (an SVG image does not
 * load them). A browser (Append HMI Web) downloads the file.
 */
HmiScreenPdf = function() {};

HmiScreenPdf.FUNCTION = 'ScreenToPDF';

/** Landscape Letter, in points, and the least margin (1/4"). */
HmiScreenPdf.PAGE = {width: 792, height: 612, margin: 18};

/** Windows' reserved device names, which no file may be called. */
HmiScreenPdf.RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;

/** A save is in progress: another ScreenToPDF() waits for it to finish. */
HmiScreenPdf.busy = false;

/**
 * A file name (without .pdf) from a page name: characters no file system
 * takes are replaced by "_", trailing dots and spaces dropped, reserved
 * device names given a "_", and an empty result becomes "Screen".
 */
HmiScreenPdf.fileName = function(name)
{
	var s = String((name != null) ? name : '').replace(/[\x00-\x1f\x7f<>:"\/\\|?*]/g, '_')
		.replace(/[. ]+$/, '').replace(/^\s+/, '');

	if (s.length > 120)
	{
		s = s.substring(0, 120).replace(/[. ]+$/, '');
	}

	// Nothing but replacements left: no name worth keeping
	if (/^[_. ]*$/.test(s))
	{
		s = '';
	}

	if (HmiScreenPdf.RESERVED.test(s.replace(/\..*$/, '')))
	{
		s = s + '_';
	}

	return (s !== '') ? s : 'Screen';
};

/** Where a w x h image goes on the page: fitted inside the margins, centered. */
HmiScreenPdf.layout = function(w, h)
{
	var p = HmiScreenPdf.PAGE;
	var scale = Math.min((p.width - 2 * p.margin) / w, (p.height - 2 * p.margin) / h);
	var width = w * scale;
	var height = h * scale;

	return {x: (p.width - width) / 2, y: (p.height - height) / 2, width: width, height: height};
};

// ------------------------------------------------------------ the call

/** ScreenToPDF() from a script; manager is the Run's HmiWindowManager. */
HmiScreenPdf.call = function(manager, args)
{
	if (manager == null || !manager.running || manager.screen == null)
	{
		HmiScreenPdf.report(null, 'The screen can only be saved while the application runs.');

		return 0;
	}

	if (HmiScreenPdf.busy)
	{
		HmiLog.log('ScreenToPDF: a screen is already being saved');

		return 0;
	}

	var ui = manager.ui;
	var name = HmiScreenPdf.fileName(HmiScreenPdf.screenName(manager));
	var io = HmiScreenPdf.io();
	HmiScreenPdf.busy = true;

	var finish = function(error, file)
	{
		HmiScreenPdf.busy = false;

		if (error != null)
		{
			HmiScreenPdf.report(ui, error);
		}
		else if (file != null)
		{
			HmiScreenPdf.log('info', 'saved the screen to ' + file);
		}
	};

	try
	{
		io.capture(manager.screen, {atDesignSize: function(fn) { return manager.atDesignSize(fn); }}, function(error, canvas)
		{
			if (error != null || canvas == null)
			{
				finish('The screen could not be captured' + ((error != null) ? ': ' + error : '') + '.');

				return;
			}

			HmiScreenPdf.build(canvas, name, function(error, bytes)
			{
				if (error != null)
				{
					finish('The PDF could not be made: ' + error + '.');

					return;
				}

				io.save(name, bytes, function(error, file)
				{
					finish((error != null) ? 'The file could not be written: ' + error + '.' : null, file);
				});
			});
		});
	}
	catch (e)
	{
		finish('The screen could not be saved: ' + e.message + '.');
	}

	return 1;
};

/**
 * The name of the page shown as the screen: the newest replace window, else
 * the newest overlay, else the newest window.
 */
HmiScreenPdf.screenName = function(manager)
{
	var wins = manager.windows || [];
	var types = ['replace', 'overlay', 'popup'];

	for (var t = 0; t < types.length; t++)
	{
		for (var i = wins.length - 1; i >= 0; i--)
		{
			if (wins[i].props != null && wins[i].props.type === types[t])
			{
				return wins[i].name;
			}
		}
	}

	return (wins.length > 0) ? wins[wins.length - 1].name : '';
};

HmiScreenPdf.report = function(ui, message)
{
	var call = HmiScreenPdf.FUNCTION + '()';
	HmiScreenPdf.log('warn', call + ' failed: ' + message);

	if (ui != null)
	{
		HmiDialogs.queueFunctionError(ui, call, message);
	}
};

HmiScreenPdf.log = function(level, message)
{
	if (level === 'warn')
	{
		HmiLog.warn('screen: ' + message);
	}
	else
	{
		HmiLog.log('screen: ' + message);
	}

	if (typeof HmiRuntimeApp !== 'undefined' && HmiRuntimeApp.isActive())
	{
		HmiRuntimeApp.log(level, message);
	}
};

/** Capture and save: replaceable (the self test), else desktop or browser. */
HmiScreenPdf.io = function()
{
	if (HmiScreenPdf.testIo != null)
	{
		return HmiScreenPdf.testIo;
	}

	var web = window.electron != null && window.electron.hmiWeb === true;

	return (web || !HmiRecipes.available()) ? HmiScreenPdf.browserIo : HmiScreenPdf.desktopIo;
};

// ------------------------------------------------------------ capture and save

/** The desktop apps: drawn, or captured by the main process; saved by it. */
HmiScreenPdf.desktopIo = {
	capture: function(screen, options, fn)
	{
		var fallback = HmiScreenPdf.desktopIo.captureWindow;

		if (!HmiScreenPdf.selfContained(screen))
		{
			fallback(screen, fn);

			return;
		}

		HmiScreenPdf.drawElement(screen, options, function(error, canvas)
		{
			if (error != null || !HmiScreenPdf.readable(canvas))
			{
				fallback(screen, fn);
			}
			else
			{
				fn(null, canvas);
			}
		});
	},
	captureWindow: function(screen, fn)
	{
		var r = HmiScreenPdf.visibleRect(screen);

		if (r == null)
		{
			fn('the screen is not visible');

			return;
		}

		window.electron.request({action: 'hmiScreenPdf.capture', rect: r}, function(url)
		{
			HmiScreenPdf.imageToCanvas(url, 1, fn);
		}, function(message) { fn(message); });
	},
	save: function(name, bytes, fn)
	{
		window.electron.request({action: 'hmiScreenPdf.save', defaultName: name,
			data: HmiScreenPdf.toBase64(bytes)},
			function(file) { fn(null, file); }, function(message) { fn(message); });
	}
};

/** A browser: the screen's elements drawn onto a canvas, and a download. */
HmiScreenPdf.browserIo = {
	capture: function(screen, options, fn)
	{
		HmiScreenPdf.drawElement(screen, options, fn);
	},
	save: function(name, bytes, fn)
	{
		try
		{
			var blob = new Blob([bytes], {type: 'application/pdf'});
			var a = document.createElement('a');
			a.href = URL.createObjectURL(blob);
			a.download = name + '.pdf';
			document.body.appendChild(a);
			a.click();
			document.body.removeChild(a);
			window.setTimeout(function() { URL.revokeObjectURL(a.href); }, 10000);
			fn(null, a.download);
		}
		catch (e)
		{
			fn(e.message);
		}
	}
};

/** Whether every picture on the screen is embedded (a data: URL). */
HmiScreenPdf.selfContained = function(el)
{
	var pics = el.querySelectorAll('img, image');

	for (var i = 0; i < pics.length; i++)
	{
		var src = pics[i].getAttribute('src') || pics[i].getAttribute('href') ||
			pics[i].getAttributeNS('http://www.w3.org/1999/xlink', 'href') || '';

		if (src !== '' && src.substring(0, 5) !== 'data:')
		{
			return false;
		}
	}

	return true;
};

/** Whether a canvas's pixels can be read (not tainted). */
HmiScreenPdf.readable = function(canvas)
{
	try
	{
		canvas.getContext('2d').getImageData(0, 0, 1, 1);

		return true;
	}
	catch (e)
	{
		return false;
	}
};

/** The part of the screen inside the window, in CSS pixels. */
HmiScreenPdf.visibleRect = function(screen)
{
	var b = screen.getBoundingClientRect();
	var x = Math.max(0, b.left);
	var y = Math.max(0, b.top);
	var r = Math.min(window.innerWidth, b.right);
	var btm = Math.min(window.innerHeight, b.bottom);

	if (r - x < 1 || btm - y < 1)
	{
		return null;
	}

	return {x: Math.floor(x), y: Math.floor(y), width: Math.ceil(r - x), height: Math.ceil(btm - y)};
};

HmiScreenPdf.imageToCanvas = function(url, scale, fn)
{
	var img = new Image();

	img.onload = function()
	{
		try
		{
			var canvas = document.createElement('canvas');
			canvas.width = Math.max(1, Math.round(img.width * scale));
			canvas.height = Math.max(1, Math.round(img.height * scale));
			var g = canvas.getContext('2d');
			g.fillStyle = '#ffffff';
			g.fillRect(0, 0, canvas.width, canvas.height);
			g.drawImage(img, 0, 0, canvas.width, canvas.height);
			fn(null, canvas);
		}
		catch (e)
		{
			fn(e.message);
		}
	};

	img.onerror = function() { fn('the image could not be loaded'); };
	img.src = url;
};

/**
 * Draws an element and its children onto a canvas through an SVG
 * foreignObject, with the page's style sheets. options.atDesignSize, when
 * given, runs the copy with the screen laid out at its design size, so the
 * page is sharp however small the screen is shown.
 */
HmiScreenPdf.drawElement = function(el, options, fn)
{
	var copy = null;
	var take = function() { copy = HmiScreenPdf.copyElement(el); };

	if (options != null && options.atDesignSize != null)
	{
		options.atDesignSize(take);
	}
	else
	{
		take();
	}

	var w = copy.width;
	var h = copy.height;

	if (w < 1 || h < 1)
	{
		fn('the screen is not visible');

		return;
	}

	var css = [];

	for (var i = 0; i < document.styleSheets.length; i++)
	{
		try
		{
			var rules = document.styleSheets[i].cssRules;

			for (var j = 0; j < rules.length; j++)
			{
				css.push(rules[j].cssText);
			}
		}
		catch (e)
		{
			// A sheet from another origin cannot be listed
		}
	}

	var root = document.createElement('div');
	root.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
	root.style.cssText = 'width:' + w + 'px;height:' + h + 'px;overflow:hidden;font-family:' +
		window.getComputedStyle(document.body).fontFamily + ';';
	var style = document.createElement('style');
	style.textContent = css.join('\n');
	root.appendChild(style);
	root.appendChild(copy.node);

	var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '">' +
		'<foreignObject x="0" y="0" width="100%" height="100%">' +
		new XMLSerializer().serializeToString(root) + '</foreignObject></svg>';

	// About 2000 pixels across, but never below the screen's own size
	HmiScreenPdf.imageToCanvas('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg),
		Math.min(2, Math.max(1, 2000 / w)), fn);
};

/** A detached copy of the element as it is now, with its size. */
HmiScreenPdf.copyElement = function(el)
{
	var clone = el.cloneNode(true);
	clone.style.position = 'relative';
	clone.style.left = '0px';
	clone.style.top = '0px';
	clone.style.transform = '';

	// Canvases are cloned blank: their pixels go across as images
	var from = el.querySelectorAll('canvas');
	var to = clone.querySelectorAll('canvas');

	for (var i = 0; i < from.length && i < to.length; i++)
	{
		try
		{
			var img = document.createElement('img');
			img.src = from[i].toDataURL();
			img.style.cssText = from[i].style.cssText;
			img.width = from[i].width;
			img.height = from[i].height;
			to[i].parentNode.replaceChild(img, to[i]);
		}
		catch (e)
		{
			// A tainted canvas stays blank
		}
	}

	return {node: clone, width: el.offsetWidth, height: el.offsetHeight};
};

// ------------------------------------------------------------ the PDF

/**
 * A one-page PDF holding the canvas as an image, to fn(error, Uint8Array).
 * The image is lossless (Flate), through pako when the editor has it, else
 * the browser's CompressionStream.
 */
HmiScreenPdf.build = function(canvas, title, fn)
{
	var w = canvas.width;
	var h = canvas.height;
	var rgba;

	try
	{
		rgba = canvas.getContext('2d').getImageData(0, 0, w, h).data;
	}
	catch (e)
	{
		fn('the screen image cannot be used (' + e.message + ')');

		return;
	}

	// Onto white: the page has no alpha channel
	var rgb = new Uint8Array(w * h * 3);

	for (var i = 0, j = 0; i < rgba.length; i += 4, j += 3)
	{
		var a = rgba[i + 3] / 255;
		rgb[j] = Math.round(rgba[i] * a + 255 * (1 - a));
		rgb[j + 1] = Math.round(rgba[i + 1] * a + 255 * (1 - a));
		rgb[j + 2] = Math.round(rgba[i + 2] * a + 255 * (1 - a));
	}

	HmiScreenPdf.deflate(rgb, function(error, data)
	{
		if (error != null)
		{
			fn(error);

			return;
		}

		try
		{
			fn(null, HmiScreenPdf.document(w, h, data, title));
		}
		catch (e)
		{
			fn(e.message);
		}
	});
};

/** zlib-compressed bytes (the PDF FlateDecode filter), to fn(error, Uint8Array). */
HmiScreenPdf.deflate = function(bytes, fn)
{
	if (typeof pako !== 'undefined' && pako.deflate != null)
	{
		try
		{
			fn(null, pako.deflate(bytes));
		}
		catch (e)
		{
			fn(e.message);
		}
	}
	else if (typeof CompressionStream !== 'undefined')
	{
		new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate')))
			.arrayBuffer().then(function(buf) { fn(null, new Uint8Array(buf)); }, function(e) { fn(e.message); });
	}
	else
	{
		fn('no compression is available');
	}
};

/** The PDF file: catalog, page, content, the image and the document title. */
HmiScreenPdf.document = function(w, h, image, title)
{
	var p = HmiScreenPdf.PAGE;
	var at = HmiScreenPdf.layout(w, h);
	var n = function(v) { return (Math.round(v * 100) / 100).toString(); };
	var content = 'q ' + n(at.width) + ' 0 0 ' + n(at.height) + ' ' + n(at.x) + ' ' + n(at.y) + ' cm /Im0 Do Q\n';

	// The title as UTF-16BE, in hex
	var hex = 'FEFF';

	for (var i = 0; i < title.length; i++)
	{
		hex += ('000' + title.charCodeAt(i).toString(16).toUpperCase()).slice(-4);
	}

	var d = new Date();
	var pad = function(v) { return (v < 10 ? '0' : '') + v; };
	var date = 'D:' + d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate()) +
		pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + pad(d.getUTCSeconds()) + 'Z';

	var objects = [
		['<< /Type /Catalog /Pages 2 0 R >>'],
		['<< /Type /Pages /Kids [3 0 R] /Count 1 >>'],
		['<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + p.width + ' ' + p.height + '] ' +
			'/Resources << /XObject << /Im0 5 0 R >> >> /Contents 4 0 R >>'],
		['<< /Length ' + content.length + ' >>\nstream\n' + content + 'endstream'],
		['<< /Type /XObject /Subtype /Image /Width ' + w + ' /Height ' + h + ' /ColorSpace /DeviceRGB ' +
			'/BitsPerComponent 8 /Filter /FlateDecode /Length ' + image.length + ' >>\nstream\n', image, '\nendstream'],
		['<< /Title <' + hex + '> /Producer (Append HMI Studio) /CreationDate (' + date + ') >>']
	];

	var chunks = [];
	var length = 0;
	var add = function(part)
	{
		var bytes = part;

		if (typeof part === 'string')
		{
			bytes = new Uint8Array(part.length);

			for (var i = 0; i < part.length; i++)
			{
				bytes[i] = part.charCodeAt(i) & 0xff;
			}
		}

		chunks.push(bytes);
		length += bytes.length;
	};

	add('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
	var offsets = [];

	for (var i = 0; i < objects.length; i++)
	{
		offsets.push(length);
		add((i + 1) + ' 0 obj\n');

		for (var j = 0; j < objects[i].length; j++)
		{
			add(objects[i][j]);
		}

		add('\nendobj\n');
	}

	var xref = length;
	var table = 'xref\n0 ' + (objects.length + 1) + '\n0000000000 65535 f \n';

	for (var i = 0; i < offsets.length; i++)
	{
		table += ('000000000' + offsets[i]).slice(-10) + ' 00000 n \n';
	}

	add(table + 'trailer\n<< /Size ' + (objects.length + 1) + ' /Root 1 0 R /Info 6 0 R >>\n' +
		'startxref\n' + xref + '\n%%EOF\n');

	var out = new Uint8Array(length);
	var pos = 0;

	for (var i = 0; i < chunks.length; i++)
	{
		out.set(chunks[i], pos);
		pos += chunks[i].length;
	}

	return out;
};

HmiScreenPdf.toBase64 = function(bytes)
{
	var s = '';

	for (var i = 0; i < bytes.length; i += 0x8000)
	{
		s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
	}

	return btoa(s);
};
