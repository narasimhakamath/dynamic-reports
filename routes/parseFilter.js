const parseFilter = (filter) => {
	const traverse = (obj) => {
		for (const key in obj) {
			if (typeof obj[key] === 'object' && obj[key] !== null) {
				traverse(obj[key]);
			} else if (typeof obj[key] === 'string' && /^\/.*\/$/.test(obj[key])) {
				const pattern = obj[key].slice(1, -1);
				obj[key] = new RegExp(pattern, 'i');
			}
		}

		return obj;
	};
	return traverse(filter);
};

module.exports = parseFilter;