// TODO: allow reading network URLs from 'truffle-config.js'
import commander, { CommanderStatic } from 'commander';
import fs from 'fs';
import path from 'path';
import { DeploymentResult } from './TestSetup';
import { RelayHubConfiguration } from '@rsksmart/rif-relay-contracts';
import * as config from './server-config.json';

export const RIF_RELAY_PORT = config.port;
export const RIF_RELAY_URL = config.url;
export const PERSONAL_SIGN_PREFIX = '\x19Ethereum Signed Message:\n';

export const networks = new Map<string, string>([
    ['localhost', 'http://127.0.0.1:4444'],
    ['development', 'http://127.0.0.1:4444'],
    ['rsktestnet', 'https://public-node.testnet.rsk.co'],
    ['rskmainnet', 'https://public-node.rsk.co']
]);

export function supportedNetworks(): string[] {
    return Array.from(networks.keys());
}

export function getNetworkUrl(network = ''): string {
    const match = network.match(/^(https?:\/\/.*)/) ?? [];
    return networks.get(network) ?? match[0];
}

export function getMnemonic(mnemonicFile: string): string | undefined {
    if (mnemonicFile == null) {
        return;
    }
    console.log('Using mnemonic from file ' + mnemonicFile);
    return fs
        .readFileSync(mnemonicFile, { encoding: 'utf8' })
        .replace(/\r?\n|\r/g, '');
}

export function getRelayHubConfiguration(
    configFile: string
): RelayHubConfiguration | undefined {
    if (configFile == null) {
        return;
    }
    console.log('Using hub config from file ' + configFile);
    const file = fs.readFileSync(configFile, { encoding: 'utf8' });
    return JSON.parse(file);
}

export function getRelayVerifierAddress(verifier?: string): string | undefined {
    return getAddressFromFile('build/enveloping/RelayVerifier.json', verifier);
}

export function getDeployVerifierAddress(
    verifier?: string
): string | undefined {
    return getAddressFromFile('build/enveloping/DeployVerifier.json', verifier);
}

export function getRelayHubAddress(
    defaultAddress?: string
): string | undefined {
    return getAddressFromFile('build/enveloping/RelayHub.json', defaultAddress);
}

export function getRegistryAddress(
    defaultAddress?: string
): string | undefined {
    return getAddressFromFile(
        'build/enveloping/VersionRegistry.json',
        defaultAddress
    );
}

export function getSmartWalletFactoryAddress(
    defaultAddress?: string
): string | undefined {
    return getAddressFromFile(
        'build/enveloping/SmartWalletFactory.json',
        defaultAddress
    );
}

export function getCustomSmartWalletFactoryAddress(
    defaultAddress?: string
): string | undefined {
    return getAddressFromFile(
        'build/enveloping/CustomSmartWalletFactory.json',
        defaultAddress
    );
}

export function getCustomSmartWalletDeployVerifierAddress(
    verifier?: string
): string | undefined {
    return getAddressFromFile(
        'build/enveloping/CustomSmartWalletDeployVerifier.json',
        verifier
    );
}

export function getCustomSmartWalletRelayVerifierAddress(
    verifier?: string
): string | undefined {
    return getAddressFromFile(
        'build/enveloping/CustomSmartWalletRelayVerifier.json',
        verifier
    );
}

function getAddressFromFile(
    path: string,
    defaultAddress?: string
): string | undefined {
    if (defaultAddress == null) {
        if (fs.existsSync(path)) {
            const relayHubDeployInfo = fs.readFileSync(path).toString();
            return JSON.parse(relayHubDeployInfo).address;
        }
    }
    return defaultAddress;
}

function saveContractToFile(
    address: string,
    workdir: string,
    filename: string
): void {
    fs.mkdirSync(workdir, { recursive: true });
    fs.writeFileSync(
        path.join(workdir, filename),
        `{ "address": "${address}" }`
    );
}

export function saveDeployment(
    deploymentResult: DeploymentResult,
    workdir: string
): void {
    saveContractToFile(
        deploymentResult.penalizerAddress,
        workdir,
        'Penalizer.json'
    );
    saveContractToFile(
        deploymentResult.relayHubAddress,
        workdir,
        'RelayHub.json'
    );
    saveContractToFile(
        deploymentResult.relayVerifierAddress,
        workdir,
        'RelayVerifier.json'
    );
    saveContractToFile(
        deploymentResult.deployVerifierAddress,
        workdir,
        'DeployVerifier.json'
    );
    saveContractToFile(
        deploymentResult.smartWalletTemplateAddress,
        workdir,
        'SmartWallet.json'
    );
    saveContractToFile(
        deploymentResult.smartWalletFactoryAddress,
        workdir,
        'SmartWalletFactory.json'
    );
    saveContractToFile(
        deploymentResult.versionRegistryAddress,
        workdir,
        'VersionRegistry.json'
    );
    saveContractToFile(
        deploymentResult.customSmartWalletTemplateAddress,
        workdir,
        'CustomSmartWallet.json'
    );
    saveContractToFile(
        deploymentResult.customSmartWalletFactoryAddress,
        workdir,
        'CustomSmartWalletFactory.json'
    );
    saveContractToFile(
        deploymentResult.customSmartWalletDeployVerifierAddress,
        workdir,
        'CustomSmartWalletDeployVerifier.json'
    );
    saveContractToFile(
        deploymentResult.customSmartWalletRelayVerifierAddress,
        workdir,
        'CustomSmartWalletRelayVerifier.json'
    );
}

export function showDeployment(
    deploymentResult: DeploymentResult,
    title: string | undefined
): void {
    if (title != null) {
        console.log(title);
    }
    console.log(`
  RelayHub: ${deploymentResult.relayHubAddress}
  Penalizer: ${deploymentResult.penalizerAddress}
  VersionRegistry: ${deploymentResult.versionRegistryAddress}
  SmartWalletTemplate: ${deploymentResult.smartWalletTemplateAddress}
  SmartWalletFactory: ${deploymentResult.smartWalletFactoryAddress}
  RelayVerifier: ${deploymentResult.relayVerifierAddress}
  DeployVerifier: ${deploymentResult.deployVerifierAddress}
  CustomSmartWalletTemplate: ${deploymentResult.customSmartWalletTemplateAddress}
  CustomSmartWalletFactory: ${deploymentResult.customSmartWalletFactoryAddress}
  CustomSmartWalletDeployVerifier: ${deploymentResult.customSmartWalletDeployVerifierAddress})
  CustomSmartWalletRelayVerifier: ${deploymentResult.customSmartWalletRelayVerifierAddress}`);
}

export function loadDeployment(workdir: string): DeploymentResult {
    function getAddress(name: string): string {
        return getAddressFromFile(path.join(workdir, name + '.json'));
    }

    return {
        relayHubAddress: getAddress('RelayHub'),
        penalizerAddress: getAddress('Penalizer'),
        smartWalletTemplateAddress: getAddress('SmartWallet'),
        smartWalletFactoryAddress: getAddress('SmartWalletFactory'),
        versionRegistryAddress: getAddress('VersionRegistry'),
        relayVerifierAddress: getAddress('RelayVerifier'),
        deployVerifierAddress: getAddress('DeployVerifier'),
        customSmartWalletTemplateAddress: getAddress('CustomSmartWallet'),
        customSmartWalletFactoryAddress: getAddress('CustomSmartWalletFactory'),
        customSmartWalletDeployVerifierAddress: getAddress(
            'CustomSmartWalletDeployVerifier'
        ),
        customSmartWalletRelayVerifierAddress: getAddress(
            'CustomSmartWalletRelayVerifier'
        )
    };
}

type EnvelopingOption = 'n' | 'f' | 'h' | 'm' | 'g';

export function envelopingCommander(
    options: EnvelopingOption[]
): CommanderStatic {
    options.forEach((option) => {
        switch (option) {
            case 'n':
                commander.option(
                    '-n, --network <url|name>',
                    'network name or URL to an RSK node',
                    'localhost'
                );
                break;
            case 'f':
                commander.option(
                    '-f, --from <address>',
                    'account to send transactions from (default: the first account with balance)'
                );
                break;
            case 'h':
                commander.option(
                    '-h, --hub <address>',
                    'address of the hub contract (default: the address from build/enveloping/RelayHub.json if exists)'
                );
                break;
            case 'm':
                commander.option(
                    '-m, --mnemonic <mnemonic>',
                    "mnemonic file to generate private key for account 'from' (default: empty)"
                );
                break;
            case 'g':
                commander.option(
                    '-g, --gasPrice <number>',
                    'gas price to give to the transaction. Defaults to 1 gwei.',
                    '1000000000'
                );
                break;
        }
    });
    return commander;
}
