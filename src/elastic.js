const elasticsearch = require('elasticsearch');
const { unserialize, isSerialized } = require('php-serialize');
const util = require('util');
const INDEX = process.env.INDEX || 'sojuz';

const esclient = new elasticsearch.Client({
  host: process.env.ELASTICURL || 'elasticsearch:9200',
  // log: 'trace',
});

const parseAttrs = (c) => {
  if (c.attrs['component-attrs']) {
    try {
      c.attrs['component-attrs'] = JSON.parse(c.attrs['component-attrs']);
    } catch (e) {}
  }
  if (c.innerBlocks.length) {
    for (let i = 0; i < c.innerBlocks.length; i++) {
      c.innerBlocks[i] = parseAttrs(c.innerBlocks[i]);
    }
  }
  return c;
};

const elasticPing = (module.exports.elasticPing = () => {
  esclient.ping(
    {
      // ping usually has a 3000ms timeout
      requestTimeout: 1000,
    },
    (error) => {
      if (error) {
        console.log('❌ Elasticsearch is down! Retry in 10s.');
        setTimeout(elasticPing, 10000);
      } else {
        console.log('✅ Connected to elasticsearch');
        // createIndexes(esclient);
      }
    }
  );
});
setTimeout(elasticPing, 4000);

const cName = () => {
  try {
    throw new Error();
  } catch (e) {
    try {
      return e.stack.split('at ')[3].split(' ')[0];
    } catch (e) {
      return '';
    }
  }
};

const buildQuery = (
  { query, ids, id, post_type, post_name, limit, skip, order, terms, parent, filters, cap },
  userId
) => {
  const caller = cName();
  console.log(caller);
  const qs = {
    query: {
      bool: {
        must: [],
        filter: [],
      },
    },
    sort: [],
  };
  // Protected or not
  if (cap) {
    if (userId && userId != cap) {
      throw new Error('Not authorized!');
    }
    qs.query.bool.filter.push({
      term: {
        caps: cap,
      },
    });
  } else {
    qs.query.bool.filter.push({
      term: {
        protected: false,
      },
    });
  }
  //search by query sting
  if (query && query.length) {
    qs.query.bool.must.push({
      multi_match: {
        query,
        fields: ['post_title', 'post_content'],
      },
    });
  }
  // Post by it's name
  if (post_name && post_name.length) {
    qs.query.bool.must.push({
      bool: {
        should: {
          match_phrase: {
            post_name,
          },
        },
      },
    });
  }
  // Pagination
  if (limit || 'queryPost' == caller) {
    qs.size = limit ? limit : 1;
    qs.from = skip ? skip : 0;
  }
  // Post type filter
  if (post_type && post_type.length) {
    qs.query.bool.filter.push({
      term: {
        post_type,
      },
    });
  }
  // Sort results
  if (order) {
    qs.sort.push({
      [order.orderBy]: {
        order: order.direction,
      },
    });
  }
  // Default sort by date
  if ('queryPost' != caller) {
    qs.sort.push({
      post_date: { order: 'desc' },
    });
  }
  // Terms query
  if (terms && terms.length) {
    qs.query.bool.filter.push({
      nested: {
        path: 'categories',
        query: {
          bool: {
            must: [
              {
                terms: {
                  'categories.slug': terms,
                },
              },
            ],
          },
        },
      },
    });
  }
  // Children query
  if (parent >= 0) {
    qs.query.bool.filter.push({
      term: {
        post_parent: parent,
      },
    });
  }
  // Post IDs query
  if (ids && ids.length) {
    qs.query.bool.filter.push({
      terms: {
        ID: ids,
      },
    });
  }
  if (id) {
    qs.query.bool.filter.push({
      term: {
        ID: id,
      },
    });
  }
  // Meta query
  if (filters && filters.length) {
    const rawFilters = filters
      .replace('?', '')
      .split('&')
      .map((e) => e.split('=')); // [['filed_name_from', 'value], ...]
    const parsedFilters = rawFilters.map((e) => {
      const first = e.shift();
      return [...first.split('_'), e.shift()];
    }); // [['field', 'name', 'from', 'value'], ...]
    const mq = {
      post_meta: [],
      post_meta_num: [],
    };

    parsedFilters.map((e) => {
      const fq = {};
      const [val, type, ...rest] = e.reverse();
      const isNumeric = !isNaN(+val);
      const path = isNumeric ? 'post_meta_num' : 'post_meta';
      const field = [type, ...rest].reverse().join('_');

      if ('search' == field) {
        qs.query.bool.must.push({
          multi_match: {
            query: val,
            fields: ['post_title', 'post_content'],
          },
        });
        return;
      }

      if ('page' == field) {
        return;
      }

      if ('term' == field) {
        const tms = val.split(',').map((e) => e.split('|').pop());
        qs.query.bool.filter.push({
          nested: {
            path: 'categories',
            query: {
              bool: {
                must: [
                  {
                    terms: {
                      'categories.slug': tms,
                    },
                  },
                ],
              },
            },
          },
        });
        return;
      }

      // Range query for numeric metas
      if (isNumeric) {
        let op;
        switch (type) {
          case 'from':
            op = 'gte';
            break;
          case 'to':
            op = 'lte';
            break;
          case 'fromto':
            mq[path].push(
              {
                range: {
                  [`${path}.${field.replace('fromto', 'from')}`]: {
                    gte: val,
                  },
                },
              },
              {
                range: {
                  [`${path}.${field.replace('fromto', 'to')}`]: {
                    gte: val,
                  },
                },
              }
            );
            return;
          // break;
          default:
            op = 'eq';
        }
        fq.range = {
          [`${path}.${field}`]: {
            [op]: val,
          },
        };
      }
      // Terms query for non numeric metas
      else {
        fq.match = { [`${path}.${field}`]: val };
      }
      mq[path].push(fq);
    });
    // Build nested queries
    Object.keys(mq).map((k) => {
      if (mq[k].length) qs.query.bool.filter.push({
        nested: {
          path: k,
          query: {
            bool: {
              must: mq[k],
            },
          },
        },
      });
    });
  }
  // Show complete queryString
  // console.dir(qs, { depth: null });
  console.log(JSON.stringify(qs));
  return qs;
};

module.exports.elasticQuery = {
  search: async (_, params, { userId }) => {
    const { lang = '' } = params;
    console.log('user', userId);
    // Build query
    const qs = buildQuery(params, userId);
    // Execute the query
    const {
      hits: { hits = [] },
    } = await esclient.search({
      index: INDEX + lang,
      body: qs,
    });

    // eslint-disable-next-line no-underscore-dangle
    return hits.map((hit) => hit._source);
  },

  count: async (_, params, { userId }) => {
    // Build query
    const { sort, size, from, ...qs } = buildQuery(params, userId);
    const { lang = '' } = params;

    // Execute the query
    const { count } = await esclient.count({
      index: INDEX + lang,
      body: qs,
    });
    return count;
  },

  queryPost: async (_, params, { userId }) => {
    const { lang = '' } = params;
    const qs = buildQuery(params, userId);

    try {
      const {
        hits: { hits = [] },
      } = await esclient.search({
        index: INDEX + lang,
        body: qs,
      });

      if (hits.length) {
        // eslint-disable-next-line no-underscore-dangle
        return hits[0]._source;
      } else {
        throw new Error('No matched object(s)');
      }
    } catch (e) {
      if ('NotFound' == e.displayName && lang) {
        // console.log(e);
        const {
          hits: { hits = [] },
        } = await esclient.search({
          index: INDEX,
          body: qs,
        });

        if (hits.length) {
          // eslint-disable-next-line no-underscore-dangle
          return hits[0]._source;
        } else {
          throw new Error('No matched object(s)');
        }
      }
    }
  },
  suggest: async (_, { query, lang = '' }) => {
    const hl = {
      highlight: {
        pre_tag: '<em>',
        post_tag: '</em>',
      },
      size: 1,
      gram_size: 3,
      // suggest_mode: 'always',
      // string_distance: 'ngram',
      // min_word_length: 3,
    };
    const { suggest: hits } = await esclient.search({
      index: INDEX + lang,
      body: {
        query: {
          bool: {
            filter: {
              term: {
                post_type: 'product',
              },
            },
          },
        },
        suggest: {
          text: query,
          post_title: {
            // phrase: {
            // field: 'post_title',
            completion: {
              field: 'suggest',
              fuzzy: {
                fuzziness: 2,
              },
            },
            //   analyzer: 'english',
            //   ...hl,
            //   direct_generator: [
            //     {
            //       field: 'post_title',
            //       suggest_mode: 'always',
            //     },
            //   ],
            // },
          },
          post_content: {
            phrase: {
              field: 'post_content',
              analyzer: 'english',
              ...hl,
              direct_generator: [
                {
                  field: 'post_content',
                  suggest_mode: 'always',
                },
              ],
            },
          },
        },
      },
    });
    return hits;
  },
  relatedPosts: async (_, { name }) => {
    const qs = {
      size: 1,
      query: {
        match: {
          post_name: name,
        },
      },
    };
    const {
      hits: { hits = [] },
    } = await esclient.search({
      index: INDEX,
      body: qs,
    });
    if (hits.length) {
      const [
        {
          _source: {
            post_meta: { _crosssell_ids: related },
          },
        },
      ] = hits;
      delete qs.size;
      qs.query = {
        query_string: {
          query: '',
          default_field: 'ID',
        },
      };
      const ids = unserialize(related).map((e) => parseInt(e));
      qs.query.query_string.query = '(' + ids.join(') OR (') + ')';
      // console.dir(qs, { depth: null });
      const {
        hits: { hits: relatedPosts = [] },
      } = await esclient.search({
        index: INDEX,
        body: qs,
      });
      return relatedPosts.map((hit) => hit._source);
    } else {
      throw new Error('No matched object(s)');
    }
  },
};

module.exports.elasticTypes = {
  ElasticPost: {
    post_meta: (root, { fields = [] }) => {
      const { post_meta } = root;
      const metaKeys = post_meta ? Object.keys(post_meta) : [];

      metaKeys.map((key) => {
        if ('_product_image_gallery' == key) {
          post_meta[key] = post_meta[key].split(',').map((e) => parseInt(e));
        }
        if (isSerialized(post_meta[key])) {
          post_meta[key] = unserialize(post_meta[key]);
        }
        if ('_wp_attachment_metadata' == key) {
          if (post_meta[key]['colors'] && post_meta[key]['colors'].length > 1) {
            post_meta[key]['colors'] = [];
          }
        }
      });
      if (fields.length) {
        const ret = {};
        metaKeys.map((key) => {
          if (fields.includes(key)) {
            ret[key] = post_meta[key];
          }
        });
        return ret;
      } else {
        return post_meta;
      }
    },
    children: async (root) => {
      const qs = {
        query: {
          term: {
            post_parent: root.ID,
          },
        },
      };
      // console.log(JSON.stringify(qs));
      const {
        hits: { hits: relatedPosts = [] },
      } = await esclient.search({
        index: INDEX,
        body: qs,
      });
      return relatedPosts.map((hit) => hit._source);
    },
    blocks: ({ blocks }) => {
      console.log(blocks);
      return Object.values(JSON.parse(blocks))
        .filter((b) => Boolean(b.blockName))
        .map(parseAttrs);
    },
  },
};
