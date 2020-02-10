/* eslint-disable max-lines */
const fs = require('fs');
const path = require('path');
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
const { unserialize, isSerialized } = require('php-serialize');

const { getParser } = require('bowser');

const { wooQuery, wooMutation, wooSubsctiprion } = require('./woo');
const { elasticQuery, elasticTypes } = require('./elastic');

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

const gridBlockParser = require('./gridBlockParser');
const imgBlockParser = require('./imgBlockParser');

const ExtraQuery = gql`
  scalar JSON
  scalar JSONObject
  extend type Query {
    options(option_names: [String]!): JSONObject
    get_cart(cart_key: String): JSON
    get_theme_mod(names: [String!]!): JSON
    get_page(slug: String): Post
    filters(taxonomy: String, ids: String = "", metas: [MetaType]): [FilterResult]
    bookmarks: [Post]!
    terms(taxonomies: [Int]): [Post]
    count(post_type: [String], userId: Int, terms: [String]): Int
    relatedPosts(name: String!): [ElasticPost]
    categories(name: String = "category"): [Category]!
    get_order(orderId: Int): JSON
    get_orders: JSON
    get_payment_methods: JSON
    get_coupons(cart_key: String!): JSON
    search(
      query: String
      ids: [Int]
      post_type: String
      limit: Int
      skip: Int
      order: OrderInput
      parent: Int
      # userId: Int
      terms: [String]
    ): [ElasticPost]
    queryPost(id: Int, post_name: String, post_type: String, parent: Int): ElasticPost
    suggest(query: String!, post_type: [String], userId: Int, terms: [String]): SuggestionResult
    my_profile: Profile
    get_downloads: [Downloads]
    form(name: String!): FormSchema
  }
  type ElasticPost {
    ID: Int
    post_date: String
    post_content: String
    post_title: String
    post_excerpt: String
    post_status: String
    post_name: String
    post_parent: Int
    menu_order: Int
    post_type: String
    likes: Int
    post_meta(fields: [MetaType]): JSON
    thumbnail: JSONObject
    categories: JSON
    author: [JSON]
    blocks: [JSON]
    related: [JSON]
    children: [ElasticPost]
  }
  type FilterResult {
    term_id: Int
    name: String
    slug: String
    taxonomy: String
    url: String
  }
  input LineItem {
    itemKey: String
    product_id: Int
    variation_id: Int
    quantity: Int
  }
  input Address {
    first_name: String
    last_name: String
    address_1: String
    address_2: String
    city: String
    state: String
    postcode: String
    country: String
    email: String
    phone: String
  }
  input NewOrderInput {
    payment_method: String!
    billing: Address
    shipping: Address
    line_items: [LineItem!]!
  }
  type Mutation {
    login(username: String!, password: String!): JSONObject!
    register(user: UserInput!): JSON
    add_to_cart(item: LineItem!, cart_key: String): JSON
    clear_cart(cart_key: String): JSON
    remove_from_cart(item: String!, cart_key: String): JSON
    update_cart(item: LineItem!, cart_key: String): JSON
    like(post: Int!): LikeResponse!
    bookmark(post: Int!): Boolean
    checkout(order: NewOrderInput): JSON
    update_profile(user: UserInput): JSON
    apply_coupon(coupon: String!, cart_key: String!): JSON
    form(action: String!, fields: JSON): FormResult!
  }
  type FormMessage {
    field: String
    message: String
  }
  type FormResult {
    status: Int
    messages: [FormMessage]
    cb: String
    data: JSON
  }
  type FormSchema {
    key: String!
    title: String
    fields: JSON
    location: JSON
    menu_order: Int
    position: String
    style: String
    instruction_placement: String
    hide_on_screen: String
    active: Boolean
    description: String
    action: String
    modified: Int
  }
  type Subscription {
    stock_state(products: [Int!]!): StockState
  }
  input UserInput {
    username: String
    name: String
    first_name: String
    last_name: String
    email: String
    url: String
    description: String
    locale: String
    password: String
    billing: Address
    shipping: Address
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
    liked: Boolean
    type: String
  }
  extend type Thumbnail {
    url: String
    colors: [String]
  }
  extend type Category {
    thumbnail: Thumbnail
  }

  type LikeResponse {
    likes: Int!
    liked: Boolean!
  }

  type AddressData {
    first_name: String!
    last_name: String!
    address_1: String!
    address_2: String
    city: String!
    state: String
    postcode: String!
    country: String!
    email: String!
    phone: String!
  }

  type Profile {
    id: Int!
    date_created: String
    date_created_gmt: String
    date_modified: String
    date_modified_gmt: String
    email: String
    first_name: String
    last_name: String
    role: String
    username: String
    billing: AddressData
    shipping: AddressData
    is_paying_customer: Boolean
    avatar_url: String
    meta_data: JSON
  }

  type Downloads {
    download_id: String
    download_url: String
    product_id: Int
    product_name: String
    download_name: String
    order_id: Int
    order_key: String
    downloads_remaining: Int
    access_expires: String
    access_expires_gmt: String
    file: JSON
    _links: JSON
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
    _menu_item_component
    _menu_item_component_attrs
    image_meta
    location
    fullLocation
    _wp_attachment_metadata
    acf_schema
  }
  type suggestion {
    text: String!
    score: Float
    freq: Int
  }
  type suggestions {
    text: String
    offset: Int
    length: Int
    options: [suggestion]
  }
  type SuggestionResult {
    post_content: [suggestions]
    post_title: [suggestions]
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
    const ids = Object.values(unserialize(related));
    return connectors.getPosts({ ids, post_type: ['product'] });
  } else return [];
};

const ExtraResolvers = {
  Query: {
    async categories(_, { name }) {
      const [categories] = await connection.query(
        `
          SELECT t.*, tm.meta_value AS thumbnail, tt.taxonomy as type FROM wp_term_taxonomy tt
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
        terms = _ref.terms ? _ref.terms : [];

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

      if (terms.length) {
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
          return getPosts({ ids: result.map((r) => r.object_id) });
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
    options: async (root, { option_names }) => {
      // console.log(option_name);
      const res = await OptionsModel.findAll({
        where: {
          option_name: _defineProperty({}, Op.in, option_names),
        },
      });

      const ret = {};
      res.map((row) => {
        const {
          dataValues: { option_name: option, option_value: value },
        } = row;
        const retOpt = isSerialized(value) ? unserialize(value) : value;
        ret[option] = retOpt;
      });

      return ret;
    },
    form: (_, { name }) => {
      const schemaFile = path.join('/', 'acfSchema', name + '.json');
      const schemaExists = fs.existsSync(schemaFile);
      if (schemaExists) {
        return require(schemaFile);
      } else {
        return new Error('Schema does not exist');
      }
    },
    ...wooQuery,
    ...elasticQuery,
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
        const mods = unserialize(modsq.dataValues.option_value);

        const ret = {};

        if (mods) {
          await Promise.all(
            names.map(async (name) => {
              if (mods[name]) {
                switch (name) {
                  case 'custom_logo':
                    const imgs = await connectors.getThumbnails([mods[name]]);
                    ret[name] = imgs.pop();
                    break;
                  case 'nav_menu_locations':
                    const menuLocs = {};
                    const locations = Object.keys(mods[name]);
                    await Promise.all(
                      locations.map(async (key) => {
                        const {
                          dataValues: { slug },
                        } = await connectors.getTerm(mods[name][key]);
                        menuLocs[key] = slug;
                      })
                    );
                    ret[name] = menuLocs;
                    break;
                  default:
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
    async bookmarks(_, __, { userId }) {
      if (userId) {
        let result = [];
        try {
          const {
            dataValues: { meta_value: metadata },
          } = await userMetaModel.findOne({
            where: {
              user_id: userId,
              meta_key: 'bookmarks',
            },
            // logging: console.log,
          });

          result = Promise.all(JSON.parse(metadata).map(connectors.getPost));
        } catch (e) {}

        return result;
      } else {
        throw new Error('Not logged in!');
      }
    },
    // relatedPosts: async (_, { name }) => {
    //   const res = await connection.models.wp_posts.findOne({
    //     attributes: ['ID'],
    //     where: {
    //       post_name: name,
    //     },
    //   });
    //   const {
    //     dataValues: { ID },
    //   } = res;
    //   return getRelated(ID);
    // },
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
    // register: (_, { user: userData }) => {
    //   return rest()
    //     .post('/wp/v2/users', userData)
    //     .then((ret) => ret.data)
    //     .catch((e) => {
    //       throw e.response.data;
    //     });
    // },
    ...wooMutation,
    like: async (_, { post }, { userId }) => {
      // console.log(connection.models.wp_postmeta);
      if (userId) {
        const userID = parseInt(userId);
        return connectors
          .getPostmeta(post, { keys: ['post_likes'] })
          .then((ret) => {
            let newLikes = [];
            let liked = false;
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
                liked = true;
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
            } else {
              // no likes, create one
              liked = true;
              newLikes = [parseInt(userId)];
              connection.models.wp_postmeta.create({
                post_id: post,
                meta_key: 'post_likes',
                meta_value: JSON.stringify(newLikes),
              });
            }

            return {
              likes: newLikes.length,
              liked,
            };
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
            let newBookmarkValue;
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
              newBookmarkValue = false;
            } else {
              // like
              newLikes = [...bookmarksOb, post];
              newBookmarkValue = true;
            }
            userMetaModel.update(
              {
                meta_value: JSON.stringify(newLikes),
              },
              {
                where: { umeta_id },
              }
            );
            return newBookmarkValue;
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
    form: (_, { action, fields }) => {
      const builtInActions = Object.keys(ExtraResolvers.Mutation);
      const params = JSON.parse(fields);
      let data = false;
      // console.log('FM', builtInActions, params);
      if (builtInActions.includes(action)) {
        data = ExtraResolvers.Mutation[action](_, params);
        return {
          status: 200,
          messages: [],
          cb: action,
          data: data,
        };
        // console.log(data);
      } else {
        const axios = require('axios');
        const { stringify } = require('querystring');
        return axios
          .post(
            'http://wordpress/backend/wp-admin/admin-ajax.php',
            stringify({
              ...params,
              action,
            }),
            {
              headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
              },
            }
          )
          .then((res) => {
            return {
              status: res.status,
              messages: [data.data],
              cb: action,
              data: res.data,
            };
          })
          .catch((e) => {
            return {
              status: e.status,
              messages: [e.data],
              cb: action,
              data: e.data,
            };
          });
      }
    },
  },
  Subscription: {
    ...wooSubsctiprion,
  },
  Post: {
    blocks: async (root, args, ctx, { schema }) => {
      var blocks;
      if (root.dataValues) {
        const {
          dataValues: { post_content },
        } = root;
        blocks = get_blocks(post_content);
      } else {
        blocks = root.blocks;
      }
      return gridBlockParser(blocks, 'sojuz/block-grid-container', schema, args, ctx);
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
    liked: ({ dataValues: { id } }, _, ctx) => {
      const { userId } = ctx || {};
      return connectors
        .getPostmeta(id, { keys: ['post_likes'] })
        .then((ret) => {
          if (ret) {
            const [
              {
                dataValues: { meta_value: metadata },
              },
            ] = ret;
            const likesOb = JSON.parse(metadata);
            return likesOb.includes(parseInt(userId));
          } else {
            return false;
          }
        })
        .catch((e) => {
          return false;
        });
    },
    type: ({ dataValues: { post_type } }) => {
      return post_type;
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
          const parsed = unserialize(metadata);
          return parsed.colors ? Object.keys(parsed.colors).map((color) => `#${color}`) : [];
        })
        .catch((e) => console.log(e));
    },
  },
  Downloads: {
    _links: (root) => {
      for (const key in root._links) {
        root._links[key] = root._links[key].pop().href;
      }
      return root._links;
    },
  },
  ...elasticTypes,
  JSON: GraphQLJSON,
  JSONObject: GraphQLJSONObject,
};

module.exports = { ExtraQuery, ExtraResolvers };
