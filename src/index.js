import { Ulid } from "id128";
import getQuote from "./quote.js";

export default {
  async fetch(request, env) {
    const url = request.url;
    const { searchParams, pathname } = new URL(url);
    const method = request.method;

    if (request.method == "GET" && request.url.endsWith("/")) {
      var quote = getQuote();
      return new Response(quote, { status: 200 });
    }

    if (request.method == "GET" && pathname == "/admin/subscribers") {
      try {
        var limit = searchParams.get("limit") || 10;
        var subscribers = await listSubscribers(env.DB, limit);
        return new Response(JSON.stringify(subscribers), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        });
      } catch (error) {
        return new Response(error.message, { status: 500 });
      }
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

        var newSubscriber = await insertSubscriber(env.DB, subscriber);
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
    var { results } = await DB.prepare(
      `
      SELECT id, first_name AS firstName, email
      FROM subscribers
      ORDER BY id DESC
      LIMIT ?1
    `
    )
      .bind(limit)
      .all();
    return results;
  } catch (error) {
    console.error("Error listing subscribers:", error);
    throw new Error("Failed to list subscribers");
  }
}

async function insertSubscriber(DB, subscriber) {
  const { first_name, email } = subscriber;

  try {
    var userId = Ulid.generate().toCanonical();

    console.log(`Inserting subscriber ${userId}...`);

    var { success, meta } = await DB.prepare(
      "INSERT INTO subscribers (id, first_name, email) VALUES (?1, ?2, ?3)"
    )
      .bind(userId, first_name, email)
      .run();

    console.log(
      `Inserted ${meta.rows_written} subscriber in ${meta.duration}ms`
    );

    if (!success) {
      throw new Error("Failed to insert subscriber");
    }
    return {
      id: userId,
      first_name,
      email,
    };
  } catch (error) {
    if (error.message.includes("UNIQUE constraint failed: subscribers.email")) {
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
