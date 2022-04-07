const ethers = require("ethers");
const ERC20Abi = require("./ERC20Abi.json");

const WETH_MAINNET = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2";
const WETH_ROPSTEN = "0xc778417e063141139fce010982780140aa0cd5ab";

const MULTI_PROXY_MODULES = ["modules/EToken", "modules/DToken", "PToken"];
const SINGLE_PROXY_MODULES = [
  "Euler",
  "modules/Exec",
  "modules/Liquidation",
  "modules/Markets",
  "modules/Swap",
  "views/EulerGeneralView",
];

const toLower = (str) => str.charAt(0).toLowerCase() + str.substring(1);

class Euler {
  constructor(signerOrProvider, chainId = 1) {
    this.chainId = chainId;
    this.contracts = {};
    this.abis = {};
    this.addresses = {};

    this._loadInterfaces();

    this.connect(signerOrProvider);

    this.addSingleton("Euler");
    this.addSingleton("Exec");
    this.addSingleton("Liquidation");
    this.addSingleton("Markets");
    this.addSingleton("Swap");

    this._tokenCache = {};

    // this.addSingleton("EulDistributor");
    // this.addSingleton("EulStakes");
  }

  connect(signerOrProvider) {
    this.signerOrProvider = signerOrProvider;
    Object.values(this.contracts).forEach((c) => {
      c.connect(this.signerOrProvider);
    });

    return this;
  }

  addSingleton(name, abi, address) {
    const lowerCaseName = toLower(name);

    abi = abi || this.abis[lowerCaseName];
    if (!abi) throw new Error(`addSingleton: Unknown abi for ${name}`);

    address = address || this.addresses[lowerCaseName];
    if (!address) throw new Error(`addSingleton: Unknown address for ${name}`);

    this.contracts[lowerCaseName] = new ethers.Contract(
      address,
      abi,
      this.signerOrProvider
    );
  }

  erc20(address) {
    return this._addToken(address, ERC20Abi);
  }

  eToken(address) {
    return this._addToken(address, this.abis.eToken);
  }

  dToken(address) {
    return this._addToken(address, this.abis.dToken);
  }

  pToken(address) {
    return this._addToken(address, this.abis.pToken);
  }

  buildBatch(items) {
    return items.map((item) => {
      const o = {};

      const contract = this._batchItemToContract(item);

      o.allowError = Boolean(items.allowError);
      o.proxyAddr = contract.address;
      o.data = contract.interface.encodeFunctionData(item.method, item.args);

      return o;
    });
  }

  decodeBatch(items, resp) {
    const o = [];

    for (let i = 0; i < resp.length; i++) {
      o.push(
        this._batchItemToContract(items[i]).interface.decodeFunctionResult(
          items[i].method,
          resp[i].result
        )
      );
    }

    return o;
  }

  async txOpts() {
    let opts = {};

    if (process.env.TX_FEE_MUL !== undefined) {
      let feeMul = parseFloat(process.env.TX_FEE_MUL);

      let feeData = await this.signerOrProvider.getFeeData();

      opts.maxFeePerGas = ethers.BigNumber.from(
        Math.floor(feeData.maxFeePerGas.toNumber() * feeMul)
      );
      opts.maxPriorityFeePerGas = ethers.BigNumber.from(
        Math.floor(feeData.maxPriorityFeePerGas.toNumber() * feeMul)
      );
    }

    if (process.env.TX_NONCE !== undefined) {
      opts.nonce = parseInt(process.env.TX_NONCE);
    }

    if (process.env.TX_GAS_LIMIT !== undefined) {
      opts.gasLimit = parseInt(process.env.TX_GAS_LIMIT);
    }

    return opts;
  }

  _addToken(address, abi) {
    if (!this._tokenCache[address]) {
      this._tokenCache[address] = new ethers.Contract(
        address,
        abi,
        this.signerOrProvider
      );
    }

    return this._tokenCache[address].connect(this.signerOrProvider);
  }

  _batchItemToContract(item) {
    if (item.contract instanceof ethers.Contract) return item.contract;
    if (this.contracts[item.contract]) return this.contracts[item.contract];

    if (MULTI_PROXY_MODULES.includes(item.contract)) {
      return this[item.contract](item.address);
    }

    throw new Error(`_batchItemToContract: Unknown contract ${item.contract}`);
  }

  _loadInterfaces() {
    let importPath;

    if (this.chainId === 1) {
      importPath = "@eulerxyz/euler-interfaces/abis";
      this.addresses = require("@eulerxyz/euler-interfaces/addresses/addresses-mainnet.json");
      this.referenceAsset = WETH_MAINNET;
    } else if (this.chainId === 3) {
      importPath = "euler-interfaces-ropsten/abis";
      this.addresses = require("euler-interfaces-ropsten/addresses/addresses-ropsten.json");
      this.referenceAsset = WETH_ROPSTEN;
    } else {
      return;
    }

    [...MULTI_PROXY_MODULES, ...SINGLE_PROXY_MODULES].forEach((module) => {
      const name = toLower(module.split("/").pop());
      this.abis[name] = require(`${importPath}/${module}`).abi;
    });
  }
}

module.exports = Euler;
