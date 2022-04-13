# sequelize-lambda
A small wrapper for configuring and managing Sequelize in AWS Lambda functions.

## Introduction

When using Sequelize from AWS Lambda, typically with RDS, there are some things to consider.
This module provides a simple wrapper to simplify configuring Sequelize in Lambda functions to
follow the best practices at https://sequelize.org/docs/v6/other-topics/aws-lambda/, by
configuring pool options and managing connections at the start and end of function invocations.

## Installation

```
npm install sequelize-lambda
```

## Usage

* `SequelizeManager.create()` wraps `new Sequelize()` to inject appropriate options for running in AWS Lambda.
  This also stores the reference to the created `Sequelize` object
* `SequelizeManager.get()` returns any `Sequelize` instance created by `SequelizeManager.create()`, or `undefined` if not 
  yet created
* `SequelizeManager.wrapHandler()` wraps a Lambda handler function to perform connection cleanup at 
  the start of the function and closing any pending connections at the end of the function.
* `SequelizeManager.init()` and `SequelizeManager.close()` are used by `SequelizeManager.wrapHandler` but are exposed if 
  for some reason they need to be called manually.

Since lambda containers may be re-used, it's a good idea to store a `Sequelize` instance and only create it once.
This can either be done at function start, or lazily when the function needs to access sequelize.
`SequelizeManager` handles this for you by keeping a static reference created by `SequelizeManager.create()`,
accessible through `SequelizeManager.get()`.

The following example adds a `getSequelize()` function that lazily obtains a sequelize instance, 
and wraps the Lambda handler function to handle connection issues.

* If the Lambda container is used for the first time, nothing extra will happen at the start of the function 
  invocation; the instance may be created lazily later on.

* If the Lambda container is re-used, and the sequelize instance was already created in a previous invocation, the
connection pool will be reset at start.

* If an instance is created, the connection pool will be closed at end of function invocation.

* Once an instance is created, appropriate `pool` options will be injected, along with an `evict` parameter derived 
  from the approximate timeout of the Lambda function.

```
import {Handler} from 'aws-lambda';
import {Sequelize} from 'sequelize';
import SequelizeManager from 'sequelize-lambda';

function getSequelize() {
  // lazily create
  return SequelizeManager.get() || 
    SequelizeManager.create(Sequelize, 'mydatabase', 'myusername', 'mypassword', { ... });
}

const handler: Handler<SomeEvent, SomeResult> = (event, context) => {
  // ...
  
  // Do something with sequelize
  const sequelize = getSequelize();
  
  // ...
  // return some result 
};

// wrapped handler with code added at start end end of function invocation
export default SequelizeManager.wrapHandler(handler);
```

Note: Due to how TypeScript handles constructor parameters for overloaded constructors, the `create`
function may be problematic to use. As an alternative, the `register` function is offered, to allow the
client to invoke the constructor using the supplied sequelize pool options:

```
SequelizeManager.register(options => new Sequelize('mydatabase', 'myusername', 'mypassword', options));
```