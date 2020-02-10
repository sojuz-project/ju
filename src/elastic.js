const elasticsearch = require('elasticsearch');
const { unserialize, isSerialized } = require('php-serialize');
const util = require('util');
const INDEX = process.env.INDEX || 'sojuz';

const esclient = new elasticsearch.Client({
  host: process.env.ELASTICURL || 'elasticsearch:9200',
  log: 'trace',
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

module.exports.elasticQuery = {
  // eslint-disable-next-line complexity
  search: async (_, { query, ids, post_type, limit, skip, order, terms, parent }) => {
    const qs = {
      query: {
        bool: {},
      },
    };
    if (query) {
      qs.query.bool.should = [
        {
          multi_match: {
            query,
            fields: ['post_title', 'post_content'],
          },
        },
      ];
      qs.query.bool.filter = [
        {
          term: {
            post_type: 'product',
          },
        },
      ];
    }
    if (limit) {
      qs.size = limit;
      qs.from = skip ? skip : 0;
    }
    if (post_type && post_type.length) {
      if (Array.isArray(qs.query.bool.filter)) {
        qs.query.bool.filter.push({ term: { post_type: post_type } });
      } else {
        qs.query.bool.must = { term: { post_type: post_type } };
      }
    }
    if (order) {
      const sort = {};
      sort[order.orderBy] = {
        order: order.direction,
      };
      qs.sort = [sort];
    }
    if (Array.isArray(qs.sort)) {
      qs.sort.push({
        post_date: { order: 'desc' },
      });
    } else {
      qs.sort = [
        {
          post_date: { order: 'desc' },
        },
      ];
    }
    if (terms && terms.length) {
      const termsQuery = [
        {
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
        },
      ];
      if (Array.isArray(qs.query.bool.filter)) {
        qs.query.bool.filter.push(termsQuery);
      } else {
        qs.query.bool.must = termsQuery;
      }
    }
    if (parent >= 0) {
      const parentQuery = {
        term: {
          post_parent: parent,
        },
      };
      if (Array.isArray(qs.query.bool.filter)) {
        qs.query.bool.filter.push(parentQuery);
      } else {
        qs.query.bool.filter = [qs.query.bool.filter, parentQuery];
      }
    }
    if (ids && ids.length) {
      const idsQuery = {
        terms: {
          ID: ids,
        },
      };
      if (Array.isArray(qs.query.bool.filter)) {
        qs.query.bool.filter.push(idsQuery);
      } else {
        qs.query.bool.filter = [qs.query.bool.filter, idsQuery];
      }
    }
    const {
      hits: { hits = [] },
    } = await esclient.search({
      index: INDEX,
      body: qs,
    });
    // eslint-disable-next-line no-underscore-dangle
    return hits.map((hit) => hit._source);
  },
  // eslint-disable-next-line complexity
  queryPost: async (_, { id, post_name, post_type, parent }) => {
    const qs = {
      size: 1,
      query: {
        bool: {},
      },
    };
    if (post_name) {
      qs.query.bool = {
        filter: {
          bool: {
            should: {
              match_phrase: {
                post_name,
              },
            },
          },
        },
      };
    }
    if (parent >= 0) {
      const parentQuery = {
        term: {
          post_parent: parent,
        },
      };

      if (Array.isArray(qs.query.bool.filter)) {
        qs.query.bool.filter.push(parentQuery);
      } else {
        qs.query.bool.filter = [qs.query.bool.filter, parentQuery];
      }
    }
    if (id) {
      qs.query.bool.must = [
        {
          term: {
            ID: id,
          },
        },
      ];
    }
    if (post_type) {
      qs.query.bool = {
        filter: {
          term: {
            post_type,
          },
        },
      };
    }
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
  },
  suggest: async (_, { query }) => {
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
      index: INDEX,
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
      // eslint-disable-next-line complexity
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
      return blocks.filter((b) => Boolean(b.blockName)).map(parseAttrs);
    },
  },
};
