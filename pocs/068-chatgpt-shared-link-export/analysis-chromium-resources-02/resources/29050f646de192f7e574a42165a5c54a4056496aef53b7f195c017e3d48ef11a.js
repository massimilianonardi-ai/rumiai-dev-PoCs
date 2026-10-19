// Copyright 2024 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.
import{mojo}from"//resources/mojo/mojo/public/js/bindings.js";export class JSTimeDataView{decoder_;version_;fieldSpecs_;constructor(decoder,version,fieldSpecs){this.decoder_=decoder;this.version_=version;this.fieldSpecs_=fieldSpecs}get msec(){const field=this.fieldSpecs_[0];return mojo.internal.decodeStructField(this.decoder_,field,this.version_)}}