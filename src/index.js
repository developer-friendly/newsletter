import getQuote from "./quote.js";
import { Client } from "@neondatabase/serverless";
import { v4 as uuidv4 } from "uuid";

async function getDB(DATABASE_URL) {
  const client = new Client(DATABASE_URL);
  await client.connect();
  return client;
}

async function validateAdmin(authorization, env) {
  if (!authorization) {
    return false;
  }

  var encoded = authorization.replace("Basic ", "");
  const decoded = atob(encoded);
  const [username, password] = decoded.split(":");

  const adminUsername = await env.NEWSLETTER.get("ADMIN_USERNAME");
  const adminPassword = await env.NEWSLETTER.get("ADMIN_PASSWORD");

  return username == adminUsername && password == adminPassword;
}

function withAdminValidation(handler) {
  return async function validateAdminDecorator(request, env, ctx) {
    const authorization = request.headers.get("Authorization");
    if (!(await validateAdmin(authorization, env))) {
      return new Response("Unauthorized", {
        status: 401,
        headers: {
          "WWW-Authenticate": 'Basic realm="Secure Area"',
        },
      });
    }
    return await handler(request, env, ctx);
  };
}

export default {
  async fetch(request, env, ctx) {
    const url = request.url;
    const { searchParams, pathname } = new URL(url);
    const method = request.method;

    if (request.method == "GET" && request.url.endsWith("/")) {
      var quote = getQuote();
      return new Response(quote, { status: 200 });
    }

    if (request.method == "GET" && pathname == "/admin/subscribers") {
      return withAdminValidation(async function adminSubscribers(request, env) {
        try {
          var limit = searchParams.get("limit") || 10;
          var subscribers = await listSubscribers(
            await getDB(env.DATABASE_URL),
            limit
          );
          return new Response(JSON.stringify(subscribers), {
            status: 200,
            headers: {
              "Content-Type": "application/json",
            },
          });
        } catch (error) {
          return new Response(error.message, { status: 500 });
        }
      })(request, env, ctx);
    }

    if (method == "POST" && pathname == "/subscribe") {
      try {
        var subscriber = await request.json();

        if (!subscriber.first_name || !subscriber.email) {
          var valid_payload = {
            first_name: "John",
            email: "john@example.com",
          };
          return new Response(
            JSON.stringify({
              error: "Invalid payload",
              hint:
                "Payload should be in the format: " +
                JSON.stringify(valid_payload),
            }),
            { status: 400 }
          );
        }

        var newSubscriber = await insertSubscriber(env, subscriber);
        return new Response(JSON.stringify(newSubscriber), {
          status: 201,
          headers: {
            "Content-Type": "application/json",
          },
        });
      } catch (error) {
        if (error instanceof DuplicateEmailError) {
          return new Response(error.message, { status: 409 });
        }

        return new Response(error.message, { status: 500 });
      }
    }

    return new Response("Not Found", { status: 404 });
  },
};

class DuplicateEmailError extends Error {
  constructor(message) {
    super(message);
    this.name = "DuplicateEmailError";
  }
}

async function listSubscribers(DB, limit) {
  try {
    var { rows } = await DB.query(
      `
      SELECT id, name, email
      FROM subscribers
      ORDER BY id DESC
      LIMIT $1
    `,
      [limit]
    );
    return rows;
  } catch (error) {
    console.error("Error listing subscribers:", error);
    throw new Error("Failed to list subscribers");
  }
}

async function insertSubscriber(env, subscriber) {
  const { first_name, email } = subscriber;
  var DB = await getDB(env.DATABASE_URL);
  var listId = await env.NEWSLETTER.get("NEWSLETTER_LIST_ID");

  try {
    console.log(`Inserting subscriber ${email}...`);

    var userId = uuidv4();

    var insertSubscriber = await DB.query(
      `
      WITH subscriber AS (
        INSERT INTO subscribers (uuid, name, email)
        VALUES ($1, $2, $3)
        RETURNING id
      )
      INSERT INTO subscriber_lists (subscriber_id, list_id)
      SELECT id, $4
      FROM subscriber
      `,
      [userId, first_name, email, listId]
    );

    console.log(insertSubscriber);

    var rowsAffected = insertSubscriber.rowCount;

    console.log(`Inserted ${rowsAffected} subscriber`);

    if (!(rowsAffected > 0)) {
      throw new Error("Failed to insert subscriber");
    }
    return {
      first_name,
      email,
    };
  } catch (error) {
    if (
      error.message.includes("duplicate key value violates unique constraint")
    ) {
      console.error(
        `Error inserting subscriber: Email already exists ${email}`
      );
      throw new DuplicateEmailError("Email already subscribed");
    } else {
      console.error("Error inserting subscriber:", error);
      throw new Error("Subscription failed");
    }
  }
}
