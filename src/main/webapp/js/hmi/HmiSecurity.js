/**
 * Users and access levels.
 *
 * Users (name, access level 0-9999, password) are defined in HMI > Users and
 * saved in the project; passwords only as salted PBKDF2-SHA256 hashes. At run
 * time one HmiSecurityManager per Run holds who is logged in, answers the
 * _Username and _AccessLevel system tags, and runs the script functions
 * ShowLogin(), Login(user, password), Logout(), ChangePassword(old, new) and
 * ShowUserManager(). Changes made with ShowUserManager() at run time are saved
 * in the runtime's data folder (userData/users/<store>.json) and from then on
 * replace the project's list there.
 *
 * Hashing is synchronous (Login() returns its result inside a script, and the
 * browser's crypto is asynchronous only), so SHA-256, HMAC and PBKDF2 are
 * implemented here; the self test checks them against Web Crypto.
 */
HmiSecurity = function() {};

HmiSecurity.MAX_LEVEL = 9999;
HmiSecurity.ITERATIONS = 20000;
HmiSecurity.NOBODY = 'None';

// ------------------------------------------------------------------ crypto

HmiSecurity.K = [0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
	0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe,
	0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa,
	0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
	0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb,
	0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624,
	0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
	0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb,
	0xbef9a3f7, 0xc67178f2];

/** SHA-256 of a Uint8Array, as a Uint8Array of 32 bytes. */
HmiSecurity.sha256 = function(data)
{
	var K = HmiSecurity.K;
	var h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
	var len = data.length;
	var total = ((len + 9 + 63) >> 6) << 6;
	var m = new Uint8Array(total);
	m.set(data);
	m[len] = 0x80;

	var bits = len * 8;
	m[total - 4] = (bits >>> 24) & 0xff;
	m[total - 3] = (bits >>> 16) & 0xff;
	m[total - 2] = (bits >>> 8) & 0xff;
	m[total - 1] = bits & 0xff;
	m[total - 5] = Math.floor(len / 0x20000000) & 0xff;

	var w = new Int32Array(64);

	for (var off = 0; off < total; off += 64)
	{
		for (var i = 0; i < 16; i++)
		{
			w[i] = (m[off + i * 4] << 24) | (m[off + i * 4 + 1] << 16) | (m[off + i * 4 + 2] << 8) | m[off + i * 4 + 3];
		}

		for (var i = 16; i < 64; i++)
		{
			var x = w[i - 15], y = w[i - 2];
			var s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
			var s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
			w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
		}

		var a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], k = h[7];

		for (var i = 0; i < 64; i++)
		{
			var S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
			var ch = (e & f) ^ (~e & g);
			var t1 = (k + S1 + ch + K[i] + w[i]) | 0;
			var S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
			var maj = (a & b) ^ (a & c) ^ (b & c);
			var t2 = (S0 + maj) | 0;

			k = g; g = f; f = e; e = (d + t1) | 0;
			d = c; c = b; b = a; a = (t1 + t2) | 0;
		}

		h[0] = (h[0] + a) | 0; h[1] = (h[1] + b) | 0; h[2] = (h[2] + c) | 0; h[3] = (h[3] + d) | 0;
		h[4] = (h[4] + e) | 0; h[5] = (h[5] + f) | 0; h[6] = (h[6] + g) | 0; h[7] = (h[7] + k) | 0;
	}

	var out = new Uint8Array(32);

	for (var i = 0; i < 8; i++)
	{
		out[i * 4] = (h[i] >>> 24) & 0xff;
		out[i * 4 + 1] = (h[i] >>> 16) & 0xff;
		out[i * 4 + 2] = (h[i] >>> 8) & 0xff;
		out[i * 4 + 3] = h[i] & 0xff;
	}

	return out;
};

HmiSecurity.hmac = function(key, data)
{
	if (key.length > 64)
	{
		key = HmiSecurity.sha256(key);
	}

	var ipad = new Uint8Array(64 + data.length);
	var opad = new Uint8Array(64 + 32);

	for (var i = 0; i < 64; i++)
	{
		var b = (i < key.length) ? key[i] : 0;
		ipad[i] = b ^ 0x36;
		opad[i] = b ^ 0x5c;
	}

	ipad.set(data, 64);
	opad.set(HmiSecurity.sha256(ipad), 64);

	return HmiSecurity.sha256(opad);
};

/** PBKDF2-HMAC-SHA256, one 32-byte block. */
HmiSecurity.pbkdf2 = function(password, salt, iterations)
{
	var block = new Uint8Array(salt.length + 4);
	block.set(salt);
	block[salt.length + 3] = 1;

	var u = HmiSecurity.hmac(password, block);
	var t = new Uint8Array(u);

	for (var i = 1; i < iterations; i++)
	{
		u = HmiSecurity.hmac(password, u);

		for (var j = 0; j < 32; j++)
		{
			t[j] ^= u[j];
		}
	}

	return t;
};

HmiSecurity.utf8 = function(text)
{
	return new TextEncoder().encode(String(text));
};

HmiSecurity.hex = function(bytes)
{
	return Array.prototype.map.call(bytes, function(b) { return ('0' + b.toString(16)).slice(-2); }).join('');
};

HmiSecurity.fromHex = function(text)
{
	var out = new Uint8Array(text.length / 2);

	for (var i = 0; i < out.length; i++)
	{
		out[i] = parseInt(text.substr(i * 2, 2), 16);
	}

	return out;
};

/** {salt, hash, iterations} for a new password. */
HmiSecurity.hashPassword = function(password, iterations)
{
	var salt = new Uint8Array(16);
	window.crypto.getRandomValues(salt);
	var n = iterations || HmiSecurity.ITERATIONS;

	return {salt: HmiSecurity.hex(salt), iterations: n,
		hash: HmiSecurity.hex(HmiSecurity.pbkdf2(HmiSecurity.utf8(password), salt, n))};
};

HmiSecurity.verify = function(user, password)
{
	if (user == null || !user.hash || !user.salt || typeof password !== 'string')
	{
		return false;
	}

	var got = HmiSecurity.hex(HmiSecurity.pbkdf2(HmiSecurity.utf8(password),
		HmiSecurity.fromHex(user.salt), user.iterations || HmiSecurity.ITERATIONS));
	var diff = got.length ^ user.hash.length;

	for (var i = 0; i < got.length && i < user.hash.length; i++)
	{
		diff |= got.charCodeAt(i) ^ user.hash.charCodeAt(i);
	}

	return diff === 0;
};

// ------------------------------------------------------------------- users

/** A user name: letters, digits, space, . _ - @, 1 to 32 characters. */
HmiSecurity.validName = function(name)
{
	return typeof name === 'string' && /^[A-Za-z0-9][A-Za-z0-9 ._@-]{0,31}$/.test(name) &&
		name.toLowerCase() !== HmiSecurity.NOBODY.toLowerCase();
};

HmiSecurity.validLevel = function(level)
{
	var n = Number(level);

	return Number.isInteger(n) && n >= 0 && n <= HmiSecurity.MAX_LEVEL;
};

HmiSecurity.findUser = function(users, name)
{
	var lower = String(name == null ? '' : name).toLowerCase();

	for (var i = 0; i < (users || []).length; i++)
	{
		if (users[i].name.toLowerCase() === lower)
		{
			return users[i];
		}
	}

	return null;
};

/** A deep copy of a user list (records are plain data). */
HmiSecurity.copyUsers = function(users)
{
	return (users || []).map(function(u)
	{
		return {name: u.name, level: u.level, salt: u.salt, hash: u.hash, iterations: u.iterations};
	});
};

// ----------------------------------------------------------------- manager

/**
 * Who is logged in during a Run.
 *
 * @param project  the HmiProject (its users, unless options.users is given)
 * @param options  {users: the runtime's saved list or null, store,
 *                 persist(users): save runtime changes (default: main process),
 *                 ui: for the login and user dialogs}
 */
HmiSecurityManager = function(project, options)
{
	this.project = project;
	this.options = options || {};
	this.users = HmiSecurity.copyUsers((this.options.users != null) ? this.options.users : project.users);
	this.user = null;
	this.listeners = {names: [], change: []};
	this.lastInput = Date.now();
};

HmiSecurityManager.prototype.on = HmiAlarmManager.prototype.on;
HmiSecurityManager.prototype.off = HmiAlarmManager.prototype.off;
HmiSecurityManager.prototype.fire = HmiAlarmManager.prototype.fire;

HmiSecurityManager.prototype.start = function()
{
	var that = this;
	var minutes = parseFloat(this.project.settings.security.autoLogoutMin) || 0;

	this.onInput = function() { that.lastInput = Date.now(); };
	document.addEventListener('pointerdown', this.onInput, true);
	document.addEventListener('keydown', this.onInput, true);

	if (minutes > 0)
	{
		this.timer = window.setInterval(function()
		{
			that.checkIdle(Date.now());
		}, 5000);
	}
};

/** Logs out after the configured minutes without input. */
HmiSecurityManager.prototype.checkIdle = function(now)
{
	var minutes = parseFloat(this.project.settings.security.autoLogoutMin) || 0;

	if (minutes > 0 && this.user != null && now - this.lastInput >= minutes * 60000)
	{
		HmiSecurity.log('info', 'automatic logout of ' + this.user.name + ' after ' + minutes + ' min');
		this.logout();
	}
};

HmiSecurityManager.prototype.stop = function()
{
	document.removeEventListener('pointerdown', this.onInput, true);
	document.removeEventListener('keydown', this.onInput, true);

	if (this.timer != null)
	{
		window.clearInterval(this.timer);
		this.timer = null;
	}
};

HmiSecurityManager.prototype.changed = function()
{
	this.fire('names', ['_Username', '_AccessLevel']);
	this.fire('change', null);
};

HmiSecurityManager.prototype.username = function()
{
	return (this.user != null) ? this.user.name : HmiSecurity.NOBODY;
};

HmiSecurityManager.prototype.accessLevel = function()
{
	return (this.user != null) ? this.user.level : 0;
};

/** A system tag's value, as the expression engine reads it. */
HmiSecurityManager.prototype.readSystem = function(name)
{
	var map = {'_Username': this.username(), '_AccessLevel': this.accessLevel()};

	return {value: (map[name] !== undefined) ? map[name] : null,
		quality: (map[name] !== undefined) ? HmiTypes.QUALITY_GOOD : HmiTypes.QUALITY_BAD,
		timestamp: Date.now()};
};

/** Logs in when the name and password match; returns true or false. */
HmiSecurityManager.prototype.login = function(name, password)
{
	var user = HmiSecurity.findUser(this.users, name);

	if (user == null || !HmiSecurity.verify(user, String(password == null ? '' : password)))
	{
		HmiSecurity.log('warn', 'login refused for "' + name + '"');

		return false;
	}

	this.user = {name: user.name, level: user.level};
	this.lastInput = Date.now();
	HmiSecurity.log('info', 'login ' + user.name + ' (access level ' + user.level + ')');
	this.changed();

	return true;
};

HmiSecurityManager.prototype.logout = function()
{
	if (this.user == null)
	{
		return;
	}

	HmiSecurity.log('info', 'logout ' + this.user.name);
	this.user = null;
	this.changed();
};

/** The logged-in user's password; returns true or false. */
HmiSecurityManager.prototype.changePassword = function(oldPassword, newPassword)
{
	var user = (this.user != null) ? HmiSecurity.findUser(this.users, this.user.name) : null;

	if (user == null || !HmiSecurity.verify(user, String(oldPassword)) ||
		typeof newPassword !== 'string' || newPassword === '')
	{
		HmiSecurity.log('warn', 'password change refused for ' + this.username());

		return false;
	}

	var h = HmiSecurity.hashPassword(newPassword);
	user.salt = h.salt;
	user.hash = h.hash;
	user.iterations = h.iterations;
	this.saveUsers();
	HmiSecurity.log('info', 'password changed for ' + user.name);

	return true;
};

/** Replaces the user list at run time (ShowUserManager) and saves it. */
HmiSecurityManager.prototype.setUsers = function(users)
{
	this.users = HmiSecurity.copyUsers(users);

	// The logged-in user may have been renamed away or re-levelled
	if (this.user != null)
	{
		var still = HmiSecurity.findUser(this.users, this.user.name);
		this.user = (still != null) ? {name: still.name, level: still.level} : null;
	}

	this.saveUsers();
	this.changed();
};

HmiSecurityManager.prototype.saveUsers = function()
{
	var users = HmiSecurity.copyUsers(this.users);

	if (this.options.persist != null)
	{
		this.options.persist(users);
	}
	else if (this.options.store && window.electron != null && typeof window.electron.request === 'function')
	{
		window.electron.request({action: 'hmiUsers.save', store: this.options.store, users: users},
			function() {}, function(message)
		{
			HmiLog.warn('users not saved: ' + message);
		});
	}
};

/** Script functions, called by HmiRuntime for the expression engine. */
HmiSecurityManager.prototype.call = function(name, args)
{
	switch (name)
	{
		case 'Login':
			return this.login(args[0], args[1]) ? 1 : 0;
		case 'Logout':
			this.logout();
			return 1;
		case 'ChangePassword':
			return this.changePassword(args[0], args[1]) ? 1 : 0;
		case 'ShowLogin':
			if (this.options.ui != null)
			{
				HmiDialogs.showLogin(this.options.ui, this);
			}

			return 1;
		case 'ShowUserManager':
			if (this.options.ui != null)
			{
				HmiDialogs.showUsers(this.options.ui, {runtime: this});
			}

			return 1;
	}

	return null;
};

HmiSecurity.log = function(level, message)
{
	HmiLog.log('security: ' + message);

	if (typeof HmiRuntimeApp !== 'undefined' && HmiRuntimeApp.isActive())
	{
		HmiRuntimeApp.log(level, message);
	}
};

/** The runtime's saved user list, to fn(users or null). */
HmiSecurity.loadUsers = function(store, fn)
{
	if (!store || window.electron == null || typeof window.electron.request !== 'function')
	{
		fn(null);

		return;
	}

	window.electron.request({action: 'hmiUsers.load', store: store}, function(users)
	{
		fn(users);
	}, function(message)
	{
		HmiLog.warn('users not read: ' + message);
		fn(null);
	});
};
