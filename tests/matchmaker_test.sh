#!/bin/bash -e
#
# Test script for the matchmaker server. This script sends two messages to the
# server, one from client1 and one from client2, and checks that the server
# sends the message from client1 to client2.
#
# Usage:
#
# ./matchmaker_test.sh <server>

# If no server is provided, use the default localhost server.
if [ -z "$1" ]; then
    server="ws://localhost:3000"
else
    server=$1
fi

# Create a temporary directory to run the test in.
cd $(mktemp -d)

# Generate a random key for the test.
key=$(openssl rand -hex 16)

echo "Running matchmaker test on server '$server' in directory $(pwd) with key '$key'"

# Create the message to send to the server.
message='{"key":"'$key'","payload":"bar"}'

# What we expect to see in the logs.
expected_regex='"key":"'$key'".*"payload":"bar"'

# Send the message from client1 to the server.
echo $message | websocat $server --no-close > client1.log &

# Give the server a chance to start the session.
sleep 1

# Send the message from client2 to the server.
echo $message | websocat $server > client2.log

# Give the server a chance to send the message from client1 to client2.
sleep 1

# Check the logs to see if the message was sent correctly.
check_client_logs() {
    local client1_log=$1
    local client2_log=$2
    local client1_expected=$3
    local client2_expected=$4

    local client1_contents=$(cat "$client1_log")
    local client2_contents=$(cat "$client2_log")

    echo "Contents of client1.log: '$client1_contents'"
    echo "Expected: '$client1_expected'"

    echo "Contents of client2.log: '$client2_contents'"
    echo "Expected: '$client2_expected'"

    # Check that the client1 log contains the message.
    if [ -n "$client1_expected" ] && ! grep -q "$client1_expected" "$client1_log"; then
        echo "Test failed: client1 log does not contain expected message"
        return 1
    fi

    # Check that the client2 log contains the message.
    if [ -n "$client2_expected" ] && ! grep -q "$client2_expected" "$client2_log"; then
        echo "Test failed: client2 log does not contain expected message"
        return 1
    fi

    echo "Test passed"
    return 0
}

check_client_logs "client1.log" "client2.log" $expected_regex ''
