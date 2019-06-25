const { gql, PubSub, withFilter } = require('apollo-server');
const { parse: get_blocks } = require('@wordpress/block-serialization-default-parser');
const GraphQLJSON = require('graphql-type-json');
const { GraphQLJSONObject } = require('graphql-type-json');
const { connectors, Database: { connection } } = require('./db');
const Options = require('./optionsModel');
const unserialize = require('php-unserialize');

const OptionsModel = Options(connection, 'wp_');

const rest = require('./restClient');

const STOCK = 'stockChannel';
const pubsub = new PubSub();

const ExtraQuery = gql`
    scalar JSON
    scalar JSONObject
    extend type Query {
        options(option_name: String!): Option
        get_cart: JSON
    }
    input LineItem {
        product_id: Int!
        quantity: Int
    }
    type Mutation {
        login(username: String!, password: String!): JSONObject!
        add_to_cart(item: LineItem!): JSON
        clear_cart: JSON
        remove_from_cart(item: String!):  JSON
        update_cart(item: LineItem!): JSON
    }
    type Subscription {
        stock_state(products: [Int!]!): StockState
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
        blocks: [Block]
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
    }
`;

const ExtraResolvers = {
    Query: {
        options: async (root, { option_name }) => {
            // console.log(option_name);
            const res = await OptionsModel.findOne({
                where: {
                    option_name
                }
            });

            try {
                res.dataValues.option_value = unserialize.unserialize(res.dataValues.option_value);
            } catch (e) {

            }
            return res.dataValues;
        },
        get_cart: (_, __, { token, userId }) => {
            return rest(token).get(`/cocart/v1/get-cart`, {
                psrams: {
                    id: userId
                }
            }).then(d => d.data).catch(e => {throw(e.response.data)});
        }
    },
    Mutation: {
        login: (_, { username, password }) => {
            return rest().post('/jwt-auth/v1/token', {
                username,
                password
            }).then(ret => ret.data).catch(e => {throw(e.response.data)});
        },
        add_to_cart: (_, { item }, { token }) => {
            connectors.getPostmeta(item.product_id, { keys: ['_stock' /* , '_stock_status', '_product_lock' */] })
            .then(ret => {
                const  [{ dataValues: { meta_value: metas }}] = ret;
                const message = {
                    product_id: item.product_id,
                    quantity: parseFloat(metas) - item.quantity,
                    status: (parseFloat(metas) > 0)? 'instock': 'outofstock',
                    locked: Math.floor(Date.now() / 1000),
                };
                // console.log(message);
                pubsub.publish(STOCK, {stock_state: message});
            })
            .catch(e=> console.log(e));
            return rest(token).post('/cocart/v1/add-item', { ...item, return_cart: true, })
                .then(res => res.data)
                .catch(e => {throw(e.response.data)});
        },
        remove_from_cart: (_, { item }, { token }) => {
            return rest(token).delete('/cocart/v1/item', {
                params: {
                    cart_item_key: item,
                },
            }).then(res => res.data).catch(e => {throw(e.response.data)});
        },
        update_cart: (_, { item }, { token }) => {
            return rest(token).post('/cocart/v1/item', item)
                .then(res => res.data)
                .catch(e => {throw(e.response.data)});
        },
        clear_cart: (_, __, { token }) => {
            return rest(token).post('/cocart/v1/clear')
                .then(res => res.data)
                .catch(e => {throw(e.response.data)});
        },
    },
    Subscription: {
        stock_state: {
            subscribe: withFilter(
              () => pubsub.asyncIterator([STOCK]),
              ({ stock_state: { product_id } }, { products }) => {
                return (products.includes(product_id));
              }),
          },
    },
    Post: {
        blocks: (root) => {
            const { dataValues: { post_content } } = root;
            return get_blocks(post_content);
        },
    },
    JSON: GraphQLJSON,
    JSONObject: GraphQLJSONObject,
};

module.exports = { ExtraQuery, ExtraResolvers};