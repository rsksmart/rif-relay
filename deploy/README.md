# RelayHub, Relay and Demo deployment

## Prerequisites

1. Docker
2. An RSK node with JSON-RPC (optionally with an enabled wallet)
3. An account with enough RBTC
4. Server(s) where to deploy the Relay(s) and Demo

## Clone this repository

Issue the following:

```
git clone git@github.com:rsksmart/tabookey-gasless.git
```

Then, checkout the `demo` branch:

```
git checkout demo
```

## Setup a truffle console with the node

Edit the `truffle.js` file in the root directory of the cloned repository. Find the `rsk` entry. It should look something like this:

```
rsk: {
    verbose: process.env.VERBOSE,
    host: "172.17.0.2",
    port: 4444,
    network_id: "*",
}
```

Change the `host` and `port` entries to point to your RSK node's JSON-RPC endpoint. Save the file. Then, issue:

```
./dock/run.sh npx truffle console --network rsk
```

You should get a prompt like so: `truffle(rsk)>`

## Deploy the RelayHub contract

Within the truffle console from the previous step, issue:

```
truffle(rsk)> compile --all
```

Then (this will depend on the way you handle your account), with an account that
has funds, say `theAccount`, issue:

```
truffle(rsk)> rh = await RelayHub.new({from: theAccount})
```

After about 30 seconds, the transaction should be mined and you should be able to
find out the deployed contract's address:

```
truffle(rsk)> rh.address
'0x7f7f5610181bfc7A2821576eE0e2dB29241E4851'
```

Write down that address for future use.

## Relay deployment

### Build the Relay. Run:

```
./dock/run.sh make -C server
```

Repeat the following steps for each relay:

### Copy binary and scripts to your server

Copy the `build/dock-builD/server/bin/RelayHttpServer` to your server. If for example your server is at the IP `WW.XX.YY.ZZ`, issue:

```
scp build/dock-builD/server/bin/RelayHttpServer WW.XX.YY.ZZ:
```

In the same fashion, copy the `deploy/start-relay.sh` and `deploy/stop-relay.sh` files into your server. Then, within your server, move the previously copied files into a directory within your home, say `relay`.

### Copy, edit script (local ip, node ip, RelayHub address), add execution permission

Now, within your server, edit the `relay/start-relay.sh`. You'll notice that the first section has some comments on replaceable values:

```
localhost=111.111.111.111 # Public facing IP of relay goes here
port=2222

relayhubaddress=0xXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX # Replace this with relayhub address

nodeip=34.246.194.91 # Replace this with RSK node's IP address
nodeport=4444 # Replace this with RSK node's JSON-RPC port
```

Replace those values with the actual ones. You should only need to change `localhost`, `relayhubaddress` and `nodeip`. Save the file. Finally, assign execution permission to the scripts. Within your home, issue:

```
chmod ug+x relay/*.sh
```

### Start relay, write down address, backup key

Start the relay. Within your server home, issue:

```
./relay/start-relay.sh
```

Then:

```
head relay/relay.log
```

You should see something like:

```
2019/09/18 21:56:30 RelayHttpServer.go:44: RelayHttpServer starting. version: 0.4.0
2019/09/18 21:56:30 RelayHttpServer.go:216: Using RelayHub address: 0x7f7f5610181bfc7A2821576eE0e2dB29241E4851
2019/09/18 21:56:30 RelayHttpServer.go:217: Using workdir: /home/ubuntu/relay
2019/09/18 21:56:30 RelayHttpServer.go:218: shortsleep?  false
2019/09/18 21:56:30 RelayHttpServer.go:225: Constructing relay server in url  http://52.214.240.161:2222
2019/09/18 21:56:30 utils.go:40: ks accounts len 1
2019/09/18 21:56:30 utils.go:66: key extracted. addr: 0xee47fb5918d2269971f74959ee3fafe2393765fe
2019/09/18 21:56:30 RelayHttpServer.go:227: relay server address:  0xee47fb5918d2269971f74959ee3fafe2393765fe
```

Copy the address that you see (here on the last line of the output). Save it somewhere. Finally, backup the server's key: copy the only file you see within `relay/keystore` to a safe store in case you need to recover the server in the future.

If you wish to keep monitoring the server's output, issue:

```
tail -f relay/relay.log
```

### Stake relay

From within a truffle console, with an account that
has funds, say `theAccount`, issue:

```
truffle(rsk)> rh = await RelayHub.at('THE_RELAY_HUB_ADDRESS')
```

replacing `THE_RELAY_HUB_ADDRESS` with the actual `RelayHub` address. Then:

```
truffle> rh.stake('THE_SERVER_ADDRESS', 24*7*3600, {from: theAccount, value: web3.utils.toWei('1','ether')})
```

replacing `THE_SERVER_ADDRESS` with the address you wrote down when deploying the relay server. Optionally, change `7*24*3600` to the unstake delay you wish for the relay server (a minimum of a week, expressed in seconds). Finally, and also optionally, replace `('1', 'ether')` with the amount you wish to stake for the relay (a minimum of 1 ether is required). Execute the command and wait for the transaction to be mined. Once the transaction is mined, check the output of the server, it should look something like:

```
...
2019/09/19 20:50:45 RelayHttpServer.go:305: Waiting for stake...
2019/09/19 20:50:45 RelayHttpServer.go:305: Waiting for stake...
2019/09/19 20:50:45 RelayHttpServer.go:305: Waiting for stake...
2019/09/19 20:50:50 relay_server.go:314: Got staked for the first time, setting owner
2019/09/19 20:50:50 relay_server.go:316: Owner is 0x388805cb73275e70Dd321299102c455D2775697d
2019/09/19 20:50:50 relay_server.go:317: Stake: 1000000000000000000
...
```

where the owner should be the address you sent the `rh.stake` transaction from (`theAccount` in the example).

### Fund relay

The last step before the relay is fully operationable is to fund it so that it can pay for transactions. Within the same truffle console, using a funded account (in this case `theAccount`, but it needn't be the same), issue:

```
truffle(rsk)> web3.eth.sendTransaction({from: theAccount, to: THE_SERVER_ADDRESS, value: web3.utils.toWei('1','ether')})
```

replacing `THE_SERVER_ADDRESS` with the server address (the same as in the previous step), and replacing `('1', 'ether')` with the amount of funding you want for the server (no limits apply). Once the transaction is mined, check the output of the server, it should look something like:

```
2019/09/19 20:51:40 RelayHttpServer.go:317: Server's balance too low. Waiting for funding...
2019/09/19 20:51:40 RelayHttpServer.go:317: Server's balance too low. Waiting for funding...
2019/09/19 20:51:40 RelayHttpServer.go:317: Server's balance too low. Waiting for funding...
2019/09/19 20:51:50 RelayHttpServer.go:320: Relay funded. Balance: 1000000000000000000
```

where the balance should be the amount you sent (1 ether or 1000000000000000000 weis in this case).

## Demo deployment

### Deploy and fund counter contract

Within the truffle console and with an account that has funds (we will reuse `theAccount` here, but feel free to use any account), issue:

```
truffle(rsk)> counter = await Counter.new('THE_RELAY_HUB_ADDRESS', {from: theAccount})
```

Replacing `THE_RELAY_HUB_ADDRESS` with your actual deployed RelayHub address. Once the transaction is mined you should be able to find out the deployed contract's address:

```
truffle(rsk)> counter.address
'0xFd24285037507F0dC7f98833C010B3Ea53181526'
```

Write down that address for future use. Next we're going to fund the contract so that it can pay transaction fees to relayers. Issue:

```
truffle(rsk)> counter.deposit({from: theAccount, value: web3.utils.toWei('0.5','ether')})
```

Replacing `('1', 'ether')` with the amount you wish to deposit (a maximum deposit of 2 ether applies).

### Configure and build app

Copy the file `src/js/demo/app/config.json.sample` to `src/js/demo/app/config.json`. Edit it. Replace the value for `rpcHost` with your actual RSK node's JSON-RPC endpoint. Replace the value for `contractAddress` with the address of the `counter` contract you just deployed. Save the file. Then, issue:

```
./dock/run.sh npm run build-demo-prod
```

Wait for it to finish.

### Copy to destination

Generate an archive with the built app:

```
tar zcvf app.tar.gz -C src/js/demo/public .
```

Copy the generated `app.tar.gz` file to your server. If for example your server is at the IP `WW.XX.YY.ZZ`, issue:

```
scp app.tar.gz WW.XX.YY.ZZ:
```

Then on your server, create a `www` directory. Move `app.tar.gz` in there. Then, from within `www`, issue:

```
tar xzvf app.tar.gz
```

You should now have a `public` directory within `www`, containing your app. Rename that directory to `demo`:

```
mv www/public www/demo
```

Make sure `www/demo` has the right permissions:

```
chmod 755 www/demo
```

### Serve app

Using your favorite web server, serve the directory `www/demo`. We are going to use NGINX here. Issue:

```
sudo apt install nginx
```

Then:

```
sudo systemctl stop nginx
```

Then create and edit the file `/etc/nginx/sites-available/demo` (you will need to use `sudo`). Paste the following contents:

```
server {
        listen 80 default_server;
        listen [::]:80 default_server;

        root PATH_TO_YOUR_HOME/www/demo

        index index.html;

        server_name _;

        location / {
                # First attempt to serve request as file, then
                # as directory, then fall back to displaying a 404.
                try_files $uri $uri/ =404;
        }
}
```

Replace `80` with the port you wish your web server to be listening on, and `PATH_TO_YOUR_HOME` with the actual path to your home directory, on which `www` lies on.

Finally:

```
sudo systemctl nginx start
```

Using your favorite browser, point your address to your server. The demo app should be up and running.
