const express = require('express');
const router = express.Router();

/**
 * Number of entities per page on any result page.
 *
 * @type {number}
 */
const pageSize = 25;

const appliedFilters = {
    gender: ['male'],
    game: ['nl', 'afe+']
};

const availableFilters = {
    gender: {
        name: 'Gender',
        values: {male: 'Male', female: 'Female'}
    },
    game: {
        name: 'Games',
        values: {
            'nl': 'New Leaf',
            'cf': 'City Folk',
            'ww': 'Wild World',
            'afe+': 'Animal Forest e+',
            'ac': 'Animal Crossing',
            'af+': 'Animal Forest+',
            'af': 'Animal Forest'
        }
    },
    species: {
        name: 'Species',
        values: {
            alligator: 'Alligator',
            anteater: 'Anteater',
            bear: 'Bear',
            bird: 'Bird',
            bull: 'Bull',
            cat: 'Cat',
            chicken: 'Chicken',
            cow: 'Cow',
            cub: 'Cub',
            deer: 'Deer',
            dog: 'Dog',
            duck: 'Duck',
            eagle: 'Eagle',
            elephant: 'Elephant',
            frog: 'Frog',
            goat: 'Goat',
            gorilla: 'Gorilla',
            hamster: 'Hamster',
            hippo: 'Hippo',
            horse: 'Horse',
            kangaroo: 'Kangaroo',
            koala: 'Koala',
            lion: 'Lion',
            monkey: 'Monkey',
            mouse: 'Mouse',
            octopus: 'Octopus',
            ostrich: 'Ostrich',
            penguin: 'Penguin',
            pig: 'Pig',
            rabbit: 'Rabbit',
            rhino: 'Rhino',
            sheep: 'Sheep',
            squirrel: 'Squirrel',
            tiger: 'Tiger',
            wolf: 'Wolf',
        }
    },
    personality: {
        name: 'Personality',
        values: {
            cranky: 'Cranky',
            jock: 'Jock',
            lazy: 'Lazy',
            normal: 'Normal',
            peppy: 'Peppy',
            smug: 'Smug',
            snooty: 'Snooty',
            uchi: 'Uchi'
        }
    }
};

/**
 * Load villagers on a particular page number with a particular search query.
 *
 * @param collection collection of villagers from Mongo
 * @param es
 * @param pageNumber the already sanity checked page number
 * @param searchQuery
 * @returns {Promise<void>}
 */
async function find(collection, es, pageNumber, searchQuery) {
    const result = {};

    result.appliedFilters = appliedFilters; // TODO compute - remove later
    result.availableFilters = availableFilters;

    // We need aggregations for each query.
    const aggregations = {
        gender: {
            terms: {
                field: 'gender',
                size: 2
            }
        },
        personality: {
            terms: {
                field: 'personality',
                size: 50
            }
        },
        species: {
            terms: {
                field: 'species',
                size: 50
            }
        },
        game: {
            terms: {
                field: 'games',
                size: 50
            }
        },
        zodiac: {
            terms: {
                field: 'zodiac',
                size: 50
            }
        }
    };

    // Is it a search? Initialize result and ES body appropriately
    let body;
    let query;
    if (searchQuery) {
        // Disallow queries of length greater than 64
        if (searchQuery.length > 64) {
            let e = new Error('Request query too long');
            e.status = 400;
            throw e;
        }
        // Set up result set for search display
        result.pageUrlPrefix = '/villagers/search/page/';
        result.isSearch = true;
        result.searchQuery = searchQuery;
        result.searchQueryString = encodeURIComponent(searchQuery);

        // Elastic Search query and body.
        query = {
            bool: {
                should: [
                    {
                        match: {
                            name: {
                                query: searchQuery
                            }
                        }
                    },
                    {
                        match: {
                            phrase: {
                                query: searchQuery,
                                fuzziness: 'auto'
                            }
                        }
                    }
                ]
            }
        };

        body =  {
            sort: [
                "_score",
                {
                    keyword: "asc"
                }
            ],
            query: query,
            aggregations: aggregations
        };
    } else {
        result.pageUrlPrefix = '/villagers/page/';

        // Elastic Search query and body.
        query = {
            match_all: {}
        };

        body = {
            sort: [
                {
                    keyword: "asc"
                }
            ],
            query: query,
            aggregations: aggregations
        }
    }

    // Count.
    const totalCount = await es.count({
        index: 'villager',
        body: {
            query: query
        }
    });

    // Update page information.
    computePageProperties(pageNumber, pageSize, totalCount.count, result);

    result.results = [];
    if (totalCount.count > 0) {
        // Load all on this page.
        const results = await es.search({
            index: 'villager',
            from: pageSize * (result.currentPage - 1),
            size: pageSize,
            body: body
        });

        // Load the results.
        const keys = results.hits.hits.map(hit => hit._id);
        const rawResults = await collection.getByIds(keys);
        for (let r of rawResults) {
            result.results.push({
                id: r.id,
                name: r.name
            });
        }
    }

    return result;
}



/**
 * Return the given input as a parsed integer if it is a positive integer. Otherwise, return 1.
 *
 * @param value
 * @returns {number}
 */
function parsePositiveInteger(value) {
    const parsedValue = parseInt(value);
    if (Number.isNaN(parsedValue) || parsedValue < 1) {
        return 1;
    }

    return parsedValue;
}

/**
 * Return a search query, trimmed, or undefined if there really isn't a usable one.
 *
 * @param value
 * @returns {string}
 */
function parseQuery(value) {
    if (typeof value === 'string' && value.trim().length > 0) {
        return value.trim();
    }
}

/**
 * Do pagination math.
 *
 * @param pageNumber
 * @param pageSize
 * @param totalCount
 * @param result
 */
function computePageProperties(pageNumber, pageSize, totalCount, result) {
    // Totals
    result.totalCount = totalCount;
    result.totalPages = Math.ceil(totalCount / pageSize);

    // Clean up page number.
    if (pageNumber < 1) {
        pageNumber = 1;
    } else if (pageNumber > result.totalPages) {
        pageNumber = result.totalPages;
    }

    // Pagination specifics
    result.currentPage = pageNumber;
    result.startIndex = (pageSize * (pageNumber - 1) + 1);
    result.endIndex = (pageSize * pageNumber) > totalCount ? totalCount :
        (pageSize * pageNumber);
}

/**
 * Villager list and search entry point.
 *
 * @param res
 * @param next
 * @param pageNumber
<<<<<<< HEAD
 */
function listVillagers(res, next, pageNumber) {
    const data = {};
    data.pageTitle = 'All Villagers - Page ' + pageNumber;
    loadVillagers(res.app.locals.db.villagers, pageNumber)
        .then((resultSet) => {
            data.resultSet = resultSet;
            res.app.locals.db.birthdays.getBirthdays()
                .then((birthdays) => {
                    data.birthdays = birthdays;
                    data.shouldDisplayBirthdays = !(birthdays == null);
                    res.render('villagers', data);
                }).catch((next));
        }).catch(next);
}

/**
 * Search pages entry point.
 *
=======
>>>>>>> 15b16087810c0a18991c7402381202bed288c766
 * @param searchQuery
 */
function listVillagers(res, next, pageNumber, isAjax, searchQuery) {
    const data = {};
    if (searchQuery) {
        data.pageTitle = 'Search results for ' + searchQuery; // template engine handles HTML escape
    } else {
        data.pageTitle = 'All Villagers - Page ' + pageNumber;
    }

    find(res.app.locals.db.villagers, res.app.locals.es, pageNumber, searchQuery)
        .then((result) => {
            if (isAjax) {
                res.send(result);
            } else {
                res.app.locals.db.birthdays.getBirthdays()
                    .then((birthdays) => {
                        data.birthdays = birthdays;
                        data.shouldDisplayBirthdays = birthdays.length > 0;
                        data.initialState = JSON.stringify(result);
                        data.result = result;
                        res.render('villagers', data);
                    })
                    .catch(next);
            }
        })
        .catch(next);
}

/* GET villagers listing. */
router.get('/', function (req, res, next) {
    listVillagers(res, next, 1, req.query.isAjax === 'true');
});

/* GET villagers page number */
router.get('/page/:pageNumber', function (req, res, next) {
    listVillagers(res, next, parsePositiveInteger(req.params.pageNumber), req.query.isAjax === 'true');
});

/* GET villagers search */
router.get('/search', function (req, res, next) {
    listVillagers(res, next, 1, req.query.isAjax === 'true', parseQuery(req.query.q));
});

/* GET villagers search page number */
router.get('/search/page/:pageNumber', function (req, res, next) {
    listVillagers(res, next, parsePositiveInteger(req.params.pageNumber), req.query.isAjax === 'true', parseQuery(req.query.q));
});

router.get('/autocomplete', function (req, res, next) {
    // Validate query
    if (typeof req.query.q !== 'string' || req.query.q.length > 64) {
        const e = new Error('Invalid request.');
        e.status = 400; // Bad Request
        throw e;
    }

    res.app.locals.es.search({
        index: 'villager',
        body: {
            suggest: {
                villager: {
                    prefix: req.query.q,
                    completion: {
                        field: 'suggest',
                        size: 5
                    }
                }
            }
        }
    })
        .then((results) => {
            const suggestions = [];
            if (results.suggest && results.suggest.villager) {
                for (let x of results.suggest.villager) {
                    for (let y of x.options) {
                        suggestions.push(y.text);
                    }
                }
            }
            res.send(suggestions);
        })
        .catch(next);

});

module.exports = router;