#! /bin/env bash

netstat -vanp tcp | grep 8090 | awk '{print $9}' | xargs kill -9
