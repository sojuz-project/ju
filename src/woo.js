const rest = require('./restClient');
const {
  connectors,
  Database: { connection },
} = require('./db');
const { gql, PubSub, withFilter } = require('apollo-server');
const { unserialize } = require('php-unserialize');
const WooCommerceAPI = require('@woocommerce/woocommerce-rest-api').default;
const { ck: consumerKey, cs: consumerSecret } = require('./wooSecrets.js');

var WooCommerce;
try {
  WooCommerce = new WooCommerceAPI({
    url: 'http://wordpress/backend/',
    consumerKey,
    consumerSecret,
    wpAPI: true,
    version: 'wc/v3',
  });
  // console.log('>>>>>>>>>>>>>>>>>>>>>>>>>', consumerKey);
  // console.log('>>>>>>>>>>>>>>>>>>>>>>>>>', consumerSecret);
} catch (e) {
  console.log('❌ There was an error connecting to WooCommerce API: ' + e.message);
  if ('Options Error' == e.name) {
    console.log('Set your credentials using ENV vars: CUSTOMER_SECRET and CUSTOMER_KEY');
    console.log('See: https://docs.woocommerce.com/document/woocommerce-rest-api/#section-2 for details.');
  }
  // process.exit(1)
}

const STOCK = 'stockChannel';
const pubsub = new PubSub();

// eslint-disable-next-line complexity
const parseSession = async (sessValues) => {
  for (ob in sessValues) {
    if ('cookies' === ob) continue;
    try {
      sessValues[ob] = unserialize(sessValues[ob]);
      if ('cart' === ob) {
        for (const item in sessValues[ob]) {
          const lineItem = sessValues[ob][item];
          lineItem.product_name = await connection.models.wp_posts
            .findOne({
              attributes: ['post_title'],
              where: {
                ID: lineItem.product_id,
              },
            })
            .then((res) => {
              const {
                dataValues: { post_title },
              } = res;
              return post_title;
            });
          sessValues[ob][item] = lineItem;
        }
      }
    } catch (e) {
      console.log(e);
    }
  }
  return sessValues;
};

module.exports.wooQuery = {
  get_cart: (_, { cart_key }, { token, userId }) => {
    return rest(token)
      .get('/sojuz/v1/cart?key=' + cart_key)
      .then((res) => {
        return parseSession(res.data);
      })
      .catch((e) => {
        throw e;
      });
  },
  get_order: (_, { orderId }, { token, userId }) => {
    // TO-DO: Validate if can show specified order
    return WooCommerce.get(`orders/${orderId}`)
      .then((response) => {
        return response.data;
      })
      .catch((error) => {
        console.log('getOrder error', error.response.data);
      });
  },
  get_orders: (_, __, { token, userId }) => {
    // To-DO: Error message if not logged in
    return WooCommerce.get('orders', {
      customer: userId,
    })
      .then((response) => {
        return response.data;
      })
      .catch((error) => {
        console.log('getOrders error', error.response.data);
      });
  },
  get_payment_methods: () => {
    return WooCommerce.get('payment_gateways')
      .then((response) => {
        return response.data.filter((gateway) => gateway.enabled);
      })
      .catch((error) => {
        console.log('paymentMethods error', error.response.data);
      });
  },
  my_profile: (_, __, { userId }) => {
    return WooCommerce.get(`customers/${userId}`)
      .then((response) => {
        return response.data;
      })
      .catch((error) => {
        console.log('userAccount error', error.response.data);
      });
  },
  get_downloads: (_, __, { userId }) => {
    return WooCommerce.get(`customers/${userId}/downloads`)
      .then((response) => {
        return response.data;
      })
      .catch((error) => {
        console.log('downloads error', error.response.data);
      });
  },
  get_coupons: (_, { cart_key }, { token, uiserId }) => {
    return rest(token)
      .get('/sojuz/v1/cart/coupon/?key=' + cart_key)
      .then((res) => {
        return parseSession(res.data);
      })
      .catch((e) => {
        throw e;
      });
  },
};

module.exports.wooMutation = {
  add_to_cart: (_, { item, cart_key }, { token }) => {
    return rest(token)
      .post('/sojuz/v1/cart', { ...item, key: cart_key })
      .then((res) => {
        const cookies = [];
        for (i in res.headers['set-cookie']) {
          const cookie = res.headers['set-cookie'][i].split(';')[0];
          if (cookie.includes('woocommerce')) {
            cookies.push(cookie);
          }
        }
        res.data['cookies'] = cookies.join('|||');
        return parseSession(res.data);
      })
      .catch((e) => {
        throw e;
      });
  },
  remove_from_cart: (_, { item, cart_key }, { token }) => {
    return rest(token)
      .patch('/sojuz/v1/cart', {
        item_key: item,
        key: cart_key,
      })
      .then((res) => parseSession(res.data))
      .catch((e) => {
        throw e.response.data;
      });
  },
  update_cart: (_, { item, cart_key }, { token }) => {
    return rest(token)
      .update('/sojuz/v1/cart', {
        item_key: item.itemKey,
        key: cart_key,
        quantity: item.quantity,
      })
      .then((res) => parseSession(res.data))
      .catch((e) => {
        throw e.response.data;
      });
  },
  clear_cart: (_, { cart_key }, { token }) => {
    return rest(token)
      .delete('/sojuz/v1/cart?key=' + cart_key, {})
      .then((res) => parseSession(res.data))
      .catch((e) => {
        throw e.response.data;
      });
  },
  checkout: (_, { order }, { token, userId }) => {
    const data = order;
    return WooCommerce.post('orders', data)
      .then((response) => {
        const { id: order_id, order_key } = response.data;
        response.data.redirect = `/backend/checkout/order-pay/${order_id}/?pay_for_order=true&key=${order_key}`;
        return response.data;
      })
      .catch((error) => {
        console.log('checkoutError', error.response.data);
      });
  },
  register: (_, { user }) => {
    const data = user;
    return WooCommerce.post('customers', data)
      .then((response) => {
        return rest()
          .post('/jwt-auth/v1/token', {
            username: data.username,
            password: data.password,
          })
          .then((ret) => ret.data)
          .catch((e) => {
            console.log(e.response);
            throw e.response.data;
          });
        return response.data;
      })
      .catch((error) => {
        console.log('registerUser error', error.response.data);
      });
  },
  update_profile: (_, { user }, { token, userId }) => {
    const data = user;
    return WooCommerce.put(`customers/${userId}/`, data)
      .then((response) => {
        return response.data;
      })
      .catch((error) => {
        console.log('profileUpdate error', error.response.data);
      });
  },
  apply_coupon: (_, { coupon, cart_key }, { token }) => {
    return rest(token)
      .post('/sojuz/v1/cart/coupon', { coupon, key: cart_key })
      .then((res) => {
        return parseSession(res.data);
      })
      .catch((e) => {
        throw e;
      });
  },
};

module.exports.wooSubscription = {
  stock_state: {
    subscribe: withFilter(
      () => pubsub.asyncIterator([STOCK]),
      ({ stock_state: { product_id } }, { products }) => {
        return products.includes(product_id);
      }
    ),
  },
};
