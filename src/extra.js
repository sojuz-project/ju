/* eslint-disable max-lines */
const { gql, PubSub, withFilter } = require('apollo-server');
const { parse: get_blocks } = require('@wordpress/block-serialization-default-parser');
const GraphQLJSON = require('graphql-type-json');
const { GraphQLJSONObject } = require('graphql-type-json');
const {
  connectors,
  Database: { connection },
} = require('./db');
const Options = require('./optionsModel');
const Usermeta = require('./userMetaModel');
const unserialize = require('php-unserialize');
const { getParser } = require('bowser');

const _sequelize = require('sequelize');
const Op = _sequelize.default.Op;
function _defineProperty(obj, key, value) {
  if (key in obj) {
    Object.defineProperty(obj, key, { value: value, enumerable: true, configurable: true, writable: true });
  } else {
    obj[key] = value;
  }
  return obj;
}

const OptionsModel = Options(connection, 'wp_');
const userMetaModel = Usermeta(connection, 'wp_');

const rest = require('./restClient');
const axios = require('axios');

const STOCK = 'stockChannel';
const pubsub = new PubSub();

const gridBlockParser = require('./gridBlockParser');
const imgBlockParser = require('./imgBlockParser');

const ExtraQuery = gql`
  scalar JSON
  scalar JSONObject
  extend type Query {
    options(option_name: String!): Option
    get_cart(cart_key: String): JSON
    get_theme_mod(names: [String!]!): JSON
    get_page(slug: String): Post
    filters(taxonomy: String, ids: String = "", metas: [MetaType]): [FilterResult]
    bookmarks: [Post]!
    terms(taxonomies: [Int]): [Post]
    count(post_type: [String], userId: Int, terms: [String]): Int
    related(post: Int!): [Post]
    categories(name: String = "category"): [Category]!
  }
  type FilterResult {
    term_id: Int
    name: String
    slug: String
    taxonomy: String
    url: String
  }
  input LineItem {
    product_id: Int!
    quantity: Int
  }
  type Mutation {
    login(username: String!, password: String!): JSONObject!
    register(user: UserInput!): JSON
    add_to_cart(item: LineItem!, cart_key: String): JSON
    clear_cart(cart_key: String): JSON
    remove_from_cart(item: String!, cart_key: String): JSON
    update_cart(item: LineItem!, cart_key: String): JSON
    like(post: Int!): Int
    bookmark(post: Int!): Boolean
  }
  type Subscription {
    stock_state(products: [Int!]!): StockState
  }
  input UserInput {
    username: String!
    name: String
    first_name: String
    last_name: String
    email: String!
    url: String
    description: String
    locale: String
    password: String!
  }
  type StockState {
    product_id: Int!
    quantity: Int
    status: String
    locked: Int
  }
  type Option {
    option_id: Int!
    option_name: String!
    option_value: JSON
    autoload: Boolean
  }
  type Block {
    blockName: String
    attrs: JSONObject
    innerBlocks: [Block]
    innerHTML: String
  }
  extend type Post {
    blocks(tagSlug: String, page: Int, catSlug: String, postSlug: String): [Block]
    dataSources: JSON
    likes: Int
    related: [Post]
  }
  extend type Thumbnail {
    url: String
    colors: [String]!
  }
  extend type Category {
    thumbnail: Thumbnail
  }

  extend enum MetaType {
    _price
    _stock_status
    _downloadable
    _wpuf_form_id
    _edit_lock
    _edit_last
    _visibility
    total_sales
    _virtual
    _product_image_gallery
    _regular_price
    _sale_price
    _tax_status
    _tax_class
    _purchase_note
    _featured
    _weight
    _length
    _width
    _height
    _sku
    _product_attributes
    _sale_price_dates_from
    _sale_price_dates_to
    _sold_individuall
    _stock
    _backorders
    _manage_stock
    _file_paths
    _download_limit
    _download_expire
    linked_item
    _crosssell_ids
    _upsell_ids
  }
`;

const traverse = (ob) => {
  if (!ob) return 0;
  if (Array.isArray(ob)) {
    return ob;
  } else {
    return traverse(ob[Object.keys(ob)[0]]);
  }
};

const getRelated = async (id) => {
  const relatedQuery = await connectors.getPostmeta(id, { keys: ['_crosssell_ids'] });
  if (relatedQuery.length) {
    const [
      {
        dataValues: { meta_value: related },
      },
    ] = relatedQuery;
    const ids = Object.values(unserialize.unserialize(related));
    return connectors.getPosts(ids);
  } else return [];
};

const ExtraResolvers = {
  Query: {
    async categories(_, { name }) {
      const [categories] = await connection.query(
        `
          SELECT t.*, tm.meta_value AS thumbnail FROM wp_term_taxonomy tt
          LEFT JOIN wp_terms t ON (tt.term_id = t.term_id)
          LEFT JOIN wp_termmeta tm ON (tt.term_id = tm.term_id AND tm.meta_key LIKE "thumbnail_id")
          WHERE tt.taxonomy = :name
        `,
        { replacements: { name } }
      );
      const thumbnails = await connectors.getThumbnails(categories.map((cat) => cat.thumbnail));

      return categories.map((cat) => ({ ...cat, thumbnail: thumbnails.find(({ id }) => id == cat.thumbnail) }));
    },
    async count(_, _ref) {
      const post_type = _ref.post_type,
        userId = _ref.userId,
        terms = _ref.terms;

      const where = {
        post_status: 'publish',
        post_type: _defineProperty({}, Op.in, ['post']),
      };

      if (post_type) {
        where.post_type = _defineProperty({}, Op.in, post_type);
      }

      if (userId) {
        where.post_author = userId;
      }

      if (terms) {
        connection.models.wp_terms.hasMany(connection.models.wp_term_relationships, { foreignKey: 'term_taxonomy_id' });
        connection.models.wp_term_relationships.belongsTo(connection.models.wp_terms, {
          foreignKey: 'term_taxonomy_id',
        });
        const termsRes = await connection.models.wp_terms.findAll({
          where: {
            slug: _defineProperty({}, Op.in, terms),
          },
          include: [
            {
              model: connection.models.wp_term_relationships,
            },
          ],
        });
        const postIds = termsRes.map(({ dataValues: term }) => {
          return term.wp_term_relationships.map(({ dataValues: relation }) => {
            return relation.object_id;
          });
        });
        where.ID = _defineProperty({}, Op.in, postIds.flat());
      }
      ret = await connection.models.wp_posts.count({ where });
      return ret;
    },
    terms(_, { taxonomies }) {
      if (!taxonomies) {
        return getPosts();
      }

      let q =
        'SELECT object_id FROM `wp_term_relationships` WHERE `term_taxonomy_id` IN (:ids) group by object_id having count(*) = :length';

      return Database.connection
        .query(q, {
          replacements: {
            length: taxonomies.length,
            ids: taxonomies,
          },
          // type: _sequelize.QueryTypes.SELECT,
          // logging: console.log
        })
        .then((result) => {
          return getPosts(result.map((r) => r.object_id));
        });
    },
    get_page: async (_, args, { userAgent }) => {
      const { slug } = args;
      // console.log(getParser(userAgent).getPlatformType());
      let id = false;
      if (!slug) {
        const res = await OptionsModel.findOne({
          where: {
            option_name: 'page_on_front',
          },
        });
        id = res.dataValues.option_value;
      }
      return connectors.getPost(id, slug);
    },
    options: async (root, { option_name }) => {
      // console.log(option_name);
      const res = await OptionsModel.findOne({
        where: {
          option_name,
        },
      });

      try {
        res.dataValues.option_value = unserialize.unserialize(res.dataValues.option_value);
      } catch (e) {}
      return res.dataValues;
    },
    get_cart: (_, { cart_key }, { token, userId }) => {
      if (cart_key) {
        const query = 'SELECT * FROM `wp_woocommerce_sessions` WHERE `session_key` LIKE ":sessionKey"';

        return connection
          .query(query, {
            replacements: {
              sessionKey: cart_key,
            },
            //   type: _sequelize.QueryTypes.SELECT,
            logging: console.log,
          })
          .then((result) => {
            console.log('dbRes', result);
            return [];
          });
      }

      const config = {
        params: {
          id: userId,
        },
        withCredentials: true,
      };
      if (cart_key) {
        const reqCookies = cart_key ? cart_key.split('|') : [];
        console.log(reqCookies);
        config.headers = {
          Cookie: reqCookies.join('; '),
        };
        delete config.params;
      }
      return rest(token)
        .get(`/cocart/v1/get-cart`, config)
        .then((d) => {
          return d.data;
        })
        .catch((e) => {
          throw e.response.data;
        });
    },
    get_theme_mod: async (_, { names }) => {
      // console.log(connectors);
      // console.log(option_name);
      const ct = await OptionsModel.findOne({
        where: {
          option_name: 'current_theme',
        },
      });

      const currentTheme = String(ct.dataValues.option_value).toLocaleLowerCase();

      const modsq = await OptionsModel.findOne({
        where: {
          option_name: `theme_mods_${currentTheme}`,
        },
      });

      try {
        const mods = unserialize.unserialize(modsq.dataValues.option_value);

        const ret = {};

        if (mods) {
          await Promise.all(
            names.map(async (name) => {
              if (mods[name]) {
                if (name == 'custom_logo') {
                  const imgs = await connectors.getThumbnails([mods[name]]);
                  ret[name] = imgs.pop();
                } else {
                  ret[name] = mods[name];
                }
              }
            })
          );
        }
        return ret;
      } catch (e) {}
    },
    filters(_, ref) {
      // console.log('term_ids', ref.ids.split(','))
      let q =
        'SELECT DISTINCT t.term_id, t.name, t.slug, tt.taxonomy FROM `wp_terms` t LEFT JOIN wp_term_relationships tr ON (tr.term_taxonomy_id = t.term_id) LEFT JOIN wp_term_taxonomy tt ON (tt.term_id = t.term_id) WHERE tt.taxonomy LIKE :taxonomy';
      if (ref.ids) {
        q +=
          ' AND tr.object_id IN (SELECT DISTINCT object_id FROM `wp_term_relationships` WHERE `term_taxonomy_id` IN (:ids))';
      }

      var _sequelize = require('sequelize');

      return connection
        .query(q, {
          replacements: {
            taxonomy: ref.taxonomy,
            ids: ref.ids.split(',').map((r) => parseInt(r)),
          },
          type: _sequelize.QueryTypes.SELECT,
          // logging: console.log
        })
        .then((filters) => {
          console.log('filter res', filters);
          return filters;
        });
    },
    bookmarks(_, __, { userId }) {
      if (userId) {
        return userMetaModel
          .findOne({
            where: {
              user_id: userId,
              meta_key: 'bookmarks',
            },
            // logging: console.log,
          })
          .then((ret) => {
            const {
              dataValues: { umeta_id, meta_value: metadata },
            } = ret;
            const bookmarksOb = JSON.parse(metadata);
            return bookmarksOb.map((id) => connectors.getPost(id));
          })
          .catch((e) => {
            return [];
          });
      } else {
        throw new Error('Not logged in!');
      }
    },
    related(_, { post }) {
      return getRelated(post);
    },
  },
  Mutation: {
    login: (_, { username, password }) => {
      return rest()
        .post('/jwt-auth/v1/token', {
          username,
          password,
        })
        .then((ret) => ret.data)
        .catch((e) => {
          console.log(e.response);
          throw e.response.data;
        });
    },
    register: (_, { user: userData }) => {
      return rest()
        .post('/wp/v2/users', userData)
        .then((ret) => ret.data)
        .catch((e) => {
          throw e.response.data;
        });
    },
    add_to_cart: (_, { item, cart_key }, { token }) => {
      connectors
        .getPostmeta(item.product_id, { keys: ['_stock' /* , '_stock_status', '_product_lock' */] })
        .then((ret) => {
          const [
            {
              dataValues: { meta_value: metas },
            },
          ] = ret;
          const message = {
            product_id: item.product_id,
            quantity: parseFloat(metas) - item.quantity,
            status: parseFloat(metas) > 0 ? 'instock' : 'outofstock',
            locked: Math.floor(Date.now() / 1000),
          };
          // console.log(message);
          pubsub.publish(STOCK, { stock_state: message });
        })
        .catch((e) => console.log(e));
      const config = {};
      // const reqCookies = cart_key ? cart_key.split('|') : [];
      // // console.log(cart_key.replace('|',';'))
      // if (cart_key) {
      //   config.headers = {
      //     Cookie: reqCookies.join('; '),
      //   };
      // }
      return rest(token)
        .post('/cocart/v1/add-item', { ...item, return_cart: true }, config)
        .then((res) => {
          // const cookies = {}
          for (i in res.headers['set-cookie']) {
            const cookie = res.headers['set-cookie'][i].split(';')[0];
            if (cookie.includes('wp_woocommerce_session')) {
              const val = cookie.split('=').pop();
              res.data['cookies'] = val.split('%7C%7C')[0];
            }
            // if (cookie.includes('woocommerce_cart_hash')
            //     || cookie.includes('wp_woocommerce_session')
            //     || cookie.includes('woocommerce_items_in_cart')
            // )  {
            //     const [ name, value ] = cookie.split('=')
            //     cookies[name] = value
            // }
          }
          // res.data['cookies'] = cookies
          return res.data;
        })
        .catch((e) => {
          throw e;
        });
    },
    remove_from_cart: (_, { item, cart_key }, { token }) => {
      const config = {
        params: {
          cart_item_key: item,
        },
      };
      if (cart_key) {
        config.headers = {
          Cookie: cart_key,
        };
      }
      return rest(token)
        .delete('/cocart/v1/item', config)
        .then((res) => res.data)
        .catch((e) => {
          throw e.response.data;
        });
    },
    update_cart: (_, { item, cart_key }, { token }) => {
      const config = {};
      if (cart_key) {
        config.headers = {
          Cookie: cart_key,
        };
      }
      return rest(token)
        .post('/cocart/v1/item', item, config)
        .then((res) => res.data)
        .catch((e) => {
          throw e.response.data;
        });
    },
    clear_cart: (_, { cart_key }, { token }) => {
      const config = {};
      if (cart_key) {
        config.headers = {
          Cookie: cart_key,
        };
      }
      return rest(token)
        .post('/cocart/v1/clear', {}, config)
        .then((res) => res.data)
        .catch((e) => {
          throw e.response.data;
        });
    },
    like: async (_, { post }, { userId }) => {
      // console.log(connection.models.wp_postmeta);
      if (userId) {
        const userID = parseInt(userId);
        return connectors
          .getPostmeta(post, { keys: ['post_likes'] })
          .then((ret) => {
            let newLikes = [];
            if (ret.length) {
              // got likes
              const [
                {
                  dataValues: { meta_id, meta_value: metadata },
                },
              ] = ret;
              const likesOb = JSON.parse(metadata);

              if (likesOb.includes(userID)) {
                // unlike
                likesOb.splice(likesOb.indexOf(userID), 1);
                newLikes = likesOb;
              } else {
                // like
                newLikes = [...likesOb, userID];
              }
              connection.models.wp_postmeta.update(
                {
                  meta_value: JSON.stringify(newLikes),
                },
                {
                  where: { meta_id },
                }
              );
              return newLikes.length;
            } else {
              // no likes, create one
              newLikes = [parseInt(userId)];
              connection.models.wp_postmeta.create({
                post_id: post,
                meta_key: 'post_likes',
                meta_value: JSON.stringify(newLikes),
              });
              return 1;
            }
          })
          .catch((e) => console.log(e));
      } else {
        throw new Error('Not logged in!');
      }
    },
    bookmark: async (_, { post }, { userId }) => {
      if (userId) {
        const userID = parseInt(userId);
        return userMetaModel
          .findOne({
            where: {
              user_id: userId,
              meta_key: 'bookmarks',
            },
            // logging: console.log,
          })
          .then((ret) => {
            let newLikes = [];
            console.log(ret.dataValues);
            // got bookmarks
            const {
              dataValues: { umeta_id, meta_value: metadata },
            } = ret;
            const bookmarksOb = JSON.parse(metadata);
            if (bookmarksOb.includes(post)) {
              // unlike
              bookmarksOb.splice(bookmarksOb.indexOf(post), 1);
              newLikes = bookmarksOb;
            } else {
              // like
              newLikes = [...bookmarksOb, post];
            }
            userMetaModel.update(
              {
                meta_value: JSON.stringify(newLikes),
              },
              {
                where: { umeta_id },
              }
            );
            return true;
          })
          .catch((e) => {
            // no bookmarks, create one
            newLikes = [parseInt(post)];
            userMetaModel.create({
              user_id: userId,
              meta_key: 'bookmarks',
              meta_value: JSON.stringify(newLikes),
            });
            return true;
          });
      } else {
        throw new Error('Not logged in!');
      }
    },
  },
  Subscription: {
    stock_state: {
      subscribe: withFilter(
        () => pubsub.asyncIterator([STOCK]),
        ({ stock_state: { product_id } }, { products }) => {
          return products.includes(product_id);
        }
      ),
    },
  },
  Post: {
    blocks: async (root, p, _, { schema }) => {
      const {
        dataValues: { post_content },
      } = root;
      const blocks = get_blocks(post_content);
      return gridBlockParser(blocks, 'sojuz/block-grid-container', schema, p);
    },
    dataSources: async (root) => {
      const {
        dataValues: { id: post_id },
      } = root;
      const [
        {
          dataValues: { meta_value: sourcesString },
        },
      ] = await connectors.getPostmeta(post_id, { keys: ['dataSources'] });
      return sourcesString;
    },
    likes: async (root) => {
      return connectors
        .getPostmeta(root.id, { keys: ['post_likes'] })
        .then((ret) => {
          if (ret) {
            const [
              {
                dataValues: { meta_value: metadata },
              },
            ] = ret;
            const likesOb = JSON.parse(metadata);
            return likesOb.length;
          } else {
            return 0;
          }
        })
        .catch((e) => {
          return 0;
        });
    },
    related: ({ dataValues: { id } }) => {
      return getRelated(id);
    },
  },
  Thumbnail: {
    url: (root) => root.src,
    colors: (root) => {
      return connectors
        .getPostmeta(root.id, { keys: ['_wp_attachment_metadata'] })
        .then((ret) => {
          const [
            {
              dataValues: { meta_value: metadata },
            },
          ] = ret;
          const parsed = unserialize.unserialize(metadata);
          return parsed.colors ? Object.keys(parsed.colors).map((color) => `#${color}`) : [];
        })
        .catch((e) => console.log(e));
    },
  },
  JSON: GraphQLJSON,
  JSONObject: GraphQLJSONObject,
};

module.exports = { ExtraQuery, ExtraResolvers };
