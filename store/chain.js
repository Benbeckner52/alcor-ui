import WCW from '~/plugins/wallets/WCW'
import AnchoWallet from '~/plugins/wallets/Anchor'
import ProtonWallet from '~/plugins/wallets/Proton'
import ScatterWallet from '~/plugins/wallets/Scatter'

export const state = () => ({
  loginPromise: null,
  wallets: {},

  payForUser: false,
  currentWallet: 'anchor',
  lastWallet: null
})

export const mutations = {
  setWallets: (state, value) => (state.wallets = value),
  setLoginPromise: (state, value) => (state.loginPromise = value),
  setPayForUser: (state, value) => (state.payForUser = value),
  setCurrentWallet: (state, value) => (state.currentWallet = value),
  setLastWallet: (state, value) => (state.lastWallet = value)
}

export const actions = {
  init({ state, commit, dispatch, rootState, rootGetters, getters }) {
    const { network } = rootState

    const wallets = {
      anchor: new AnchoWallet(network, this.$rpc),
      scatter: new ScatterWallet(network, this.$rpc)
    }

    if (network.name == 'wax') wallets.wcw = new WCW(network, this.$rpc)
    if (network.name == 'proton')
      wallets.proton = new ProtonWallet(network, this.$rpc)

    commit('setWallets', wallets)

    if (state.lastWallet) {
      commit('setCurrentWallet', state.lastWallet)
      dispatch('autoLogin')
    }
  },

  async autoLogin({ state, dispatch, commit, getters }) {
    console.log('try autoLogin..')
    const loginned = await getters.wallet.checkLogin()
    if (loginned) {
      const { name, authorization } = loginned
      commit('setUser', { name, authorization }, { root: true })
      dispatch('afterLoginHook')

      return true
    }
    return false
  },

  afterLoginHook({ dispatch, rootState }) {
    dispatch('loadAccountData', {}, { root: true })

    dispatch('loadUserBalances', {}, { root: true }).then(() =>
      dispatch('market/updatePairBalances', {}, { root: true })
    )
    dispatch('loadAccountLimits', {}, { root: true })
      .then(() => dispatch('loadUserOrders', {}, { root: true }))
      .then(() => {
        this._vm.$nuxt.$emit('loadUserOrdersFinish')
      })

    dispatch('loadOrders', rootState.market.id, { root: true })

    this.$socket.emit('subscribe', {
      room: 'account',
      params: {
        chain: rootState.network.name,
        name: rootState.user.name
      }
    })
  },

  logout({ state, dispatch, commit, getters, rootState }) {
    console.log('logout..')
    getters.wallet.logout()
    commit('setLastWallet', null)
    this.$socket.emit('unsubscribe', {
      room: 'account',
      params: {
        chain: rootState.network.name,
        name: rootState.user.name
      }
    })

    commit('setUser', null, { root: true })
    commit('setUserOrders', [], { root: true })
  },

  async login({ state, commit, dispatch, getters, rootState }, wallet_name) {
    console.log('login..')
    commit('setCurrentWallet', wallet_name)
    const wasAutoLoginned = await dispatch('autoLogin')
    if (wasAutoLoginned) return commit('setLastWallet', wallet_name)

    const { name, authorization } = await getters.wallet.login()
    commit('setUser', { name, authorization }, { root: true })
    dispatch('afterLoginHook')

    commit('setLastWallet', wallet_name)

    //if (state.loginPromise) state.loginPromise.resolve(true)
    //if (state.loginPromise) state.loginPromise.resolve(false)
  },

  transfer({ dispatch, rootState }, { contract, actor, quantity, memo, to }) {
    return dispatch('sendTransaction', [
      {
        account: contract,
        name: 'transfer',
        authorization: [rootState.user.authorization],
        data: {
          from: actor,
          to: to || rootState.network.contract,
          quantity,
          memo
        }
      }
    ])
  },

  async cancelorder(
    { dispatch, rootState },
    { contract, account, market_id, type, order_id }
  ) {
    const r = await dispatch('sendTransaction', [
      {
        account: contract || rootState.network.contract,
        name: `cancel${type}`,
        authorization: [rootState.user.authorization],
        data: { executor: account, market_id, order_id }
      }
    ])

    setTimeout(() => dispatch('loadOrders', market_id, { root: true }), 1000)
    return r
  },

  asyncLogin({ rootState, commit, dispatch }) {
    if (rootState.user) return Promise.resolve(true)

    const loginPromise = new Promise((resolve, reject) => {
      commit('setLoginPromise', { resolve, reject })
      dispatch('modal/login', null, { root: true })
    })

    return loginPromise
  },

  async generateGiftLink({ rootState, dispatch }, { memo, asset_ids }) {
    const actions = [
      {
        account: 'atomictoolsx',
        name: 'announcelink',
        authorization: [rootState.user.authorization],
        data: {
          creator: rootState.user.name,
          key: rootState.account.permissions[0].required_auth.keys[0].key,
          asset_ids,
          memo: ''
        }
      },
      {
        account: 'atomicassets',
        name: 'transfer',
        authorization: [rootState.user.authorization],
        data: {
          from: rootState.user.name,
          to: 'atomictoolsx',
          asset_ids,
          memo: 'link'
        }
      }
    ]

    return await dispatch('sendTransaction', actions)
  },

  async cancelBuyOffers({ rootState, dispatch }, offers) {
    try {
      const cancelActions = offers.map(([buyoffer_id]) => ({
        account: 'atomicmarket',
        name: 'cancelbuyo',
        authorization: [rootState.user.authorization],
        data: { buyoffer_id }
      }))
      const withdrawActions = offers.map(([_, amount]) => ({
        account: 'atomicmarket',
        name: 'withdraw',
        authorization: [rootState.user.authorization],
        data: {
          owner: rootState.user.name,
          token_to_withdraw: (+amount / 100000000).toFixed(8) + ' WAX'
        }
      }))

      return await dispatch('sendTransaction', [
        ...cancelActions,
        ...withdrawActions
      ])
    } catch (e) {
      console.error('Cancel Offers Error', e)
    }
  },
  async cancelOffers({ rootState, dispatch }, offers) {
    try {
      const actions = offers.map((offer_id) => ({
        account: 'atomicassets',
        name: 'canceloffer',
        authorization: [rootState.user.authorization],
        data: { offer_id }
      }))

      return await dispatch('sendTransaction', actions)
    } catch (e) {
      console.error('Cancel Offers Error', e)
    }
  },

  async transferNft({ rootState, dispatch }, { memo, reciever, asset_ids }) {
    const actions = [
      {
        account: 'atomicassets',
        name: 'transfer',
        authorization: [rootState.user.authorization],
        data: {
          from: rootState.user.name,
          to: reciever,
          asset_ids,
          memo
        }
      }
    ]
    return await dispatch('sendTransaction', actions)
  },

  async cancelList({ state, rootState, dispatch }, { currentListing }) {
    const actions = [
      {
        account: 'atomicmarket',
        name: 'cancelsale',
        authorization: [rootState.user.authorization],
        data: {
          sale_id: currentListing
        }
      }
    ]
    await dispatch('sendTransaction', actions)
  },

  async cancelGifts({ rootState, dispatch }, gifts) {
    const actions = gifts.map(({ link_id }) => ({
      account: 'atomictoolsx',
      name: 'cancellink',
      authorization: [rootState.user.authorization],
      data: {
        link_id
      }
    }))

    await dispatch('sendTransaction', actions)
  },

  async cancelAuction({ state, rootState, dispatch }, { currentListing }) {
    const actions = [
      {
        account: 'atomicmarket',
        name: 'cancelauct',
        authorization: [rootState.user.authorization],
        data: {
          auction_id: currentListing
        }
      }
    ]
    await dispatch('sendTransaction', actions)
  },

  async burn({ state, rootState, dispatch }, asset_id) {
    const actions = [
      {
        account: 'atomicassets',
        name: 'burnasset',
        authorization: [rootState.user.authorization],
        data: {
          asset_owner: rootState.user.name,
          asset_id
        }
      }
    ]

    await dispatch('sendTransaction', actions)
  },

  async list(
    { state, rootState, dispatch },
    { asset_ids, listing_price, currentListing = null }
  ) {
    const actions = []
    if (currentListing)
      actions.push({
        account: 'atomicmarket',
        name: 'cancelsale',
        authorization: [rootState.user.authorization],
        data: { sale_id: currentListing }
      })
    actions.push({
      account: 'atomicmarket',
      name: 'announcesale',
      authorization: [rootState.user.authorization],
      data: {
        seller: rootState.user.name,
        asset_ids,
        listing_price,
        settlement_symbol: '8,WAX',
        maker_marketplace: ''
      }
    })
    actions.push({
      account: 'atomicassets',
      name: 'createoffer',
      authorization: [rootState.user.authorization],
      data: {
        sender: rootState.user.name,
        recipient: 'atomicmarket',
        sender_asset_ids: asset_ids,
        recipient_asset_ids: [],
        memo: 'sale'
      }
    })

    await dispatch('sendTransaction', actions)
  },

  async sendTradeOffer(
    { rootState, dispatch },
    { recipient, sender_asset_ids, recipient_asset_ids, memo = '' }
  ) {
    const actions = [
      {
        account: 'atomicassets',
        name: 'createoffer',
        authorization: [rootState.user.authorization],
        data: {
          sender: rootState.user.name,
          recipient,
          sender_asset_ids,
          recipient_asset_ids,
          memo
        }
      }
    ]
    await dispatch('sendTransaction', actions)
  },

  async auction(
    { state, rootState, dispatch },
    { asset_ids, starting_bid, duration, currentListing }
  ) {
    const actions = [
      {
        account: 'atomicmarket',
        name: 'announceauct',
        authorization: [rootState.user.authorization],
        data: {
          seller: rootState.user.name,
          asset_ids,
          starting_bid,
          duration,
          maker_marketplace: ''
        }
      },
      {
        account: 'atomicassets',
        name: 'transfer',
        authorization: [rootState.user.authorization],
        data: {
          from: rootState.user.name,
          to: 'atomicmarket',
          asset_ids,
          memo: 'auction'
        }
      }
    ]

    await dispatch('sendTransaction', actions)
  },

  async claimGift(
    { rootState, dispatch },
    { link_id, claimer, claimer_signature }
  ) {
    const actions = [
      {
        account: 'atomictoolsx',
        name: 'claimlink',
        data: {
          link_id,
          claimer,
          claimer_signature
        }
      }
    ]
    await dispatch('sendTransaction', actions)
  },

  async sendBuyOffer(
    { state, rootState, dispatch },
    { buyOfferPrice, assetsIDs, memo, seller }
  ) {
    const actions = [
      {
        account: 'eosio.token',
        name: 'transfer',
        authorization: [
          {
            actor: rootState.user.name,
            permission: 'owner'
          }
        ],
        data: {
          from: rootState.user.name,
          to: 'atomicmarket',
          quantity: buyOfferPrice,
          memo: 'deposit'
        }
      },
      {
        account: 'atomicmarket',
        name: 'createbuyo',
        authorization: [
          {
            actor: rootState.user.name,
            permission: 'owner'
          }
        ],
        data: {
          buyer: rootState.user.name,
          recipient: seller,
          price: buyOfferPrice,
          memo,
          maker_marketplace: '',
          asset_ids: assetsIDs
        }
      }
    ]
    await dispatch('sendTransaction', actions)
  },

  async buyAsset(
    { state, rootState, dispatch },
    { sale_id, asset_ids_to_assert, listing_price_to_assert }
  ) {
    const actions = [
      {
        account: 'atomicmarket',
        name: 'assertsale',
        authorization: [
          {
            actor: rootState.user.name,
            permission: 'owner'
          }
        ],
        data: {
          sale_id,
          asset_ids_to_assert,
          listing_price_to_assert,
          settlement_symbol_to_assert: '8,WAX'
        }
      },
      {
        account: 'eosio.token',
        name: 'transfer',
        authorization: [
          {
            actor: rootState.user.name,
            permission: 'owner'
          }
        ],
        data: {
          from: rootState.user.name,
          to: 'atomicmarket',
          quantity: listing_price_to_assert,
          memo: 'deposit'
        }
      },
      {
        account: 'atomicmarket',
        name: 'purchasesale',
        authorization: [
          {
            actor: rootState.user.name,
            permission: 'owner'
          }
        ],
        data: {
          buyer: rootState.user.name,
          sale_id,
          intended_delphi_median: 0,
          taker_marketplace: ''
        }
      }
    ]
    await dispatch('sendTransaction', actions)
  },

  async sendTransaction(
    { state, rootState, dispatch, getters, commit },
    actions
  ) {
    if (actions && actions[0].name != 'delegatebw') {
      await dispatch('resources/showIfNeeded', undefined, { root: true })
    }

    commit(
      'loading/OPEN',
      { title: 'Connecting Wallet', text: 'Waiting transaction approval..' },
      { root: true }
    )

    try {
      return await getters.wallet.transact(actions)
    } catch (e) {
      throw e
    } finally {
      dispatch('update', {}, { root: true })
      commit('loading/CLOSE', {}, { root: true })
    }
  }
}

export const getters = {
  chainName(state, getters, rootState) {
    return rootState.network.name
  },

  wallet: (state, getters) => state.wallets[state.currentWallet]
}
