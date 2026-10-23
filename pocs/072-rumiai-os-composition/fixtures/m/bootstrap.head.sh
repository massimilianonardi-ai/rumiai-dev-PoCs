#!/bin/sh
set -eu

m_BOOTSTRAP_BIN=$(command -p realpath -- "$0")
m_ROOT=${m_BOOTSTRAP_BIN%/*}
export m_BOOTSTRAP_BIN m_ROOT
