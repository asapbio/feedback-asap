require("dotenv").config();
const { writeFileSync } = require("fs");
const fetch = require("node-fetch");
const { stripHtml } = require("string-strip-html");
const metascraper = require("metascraper");
const jsonexport = require("jsonexport");

// api key
const apiKey = process.env.DISQUS_API_KEY || "";

// keywords to look for
const keywords = ["feedback", "request", "preprint", "comment", "public"];

// disqus apis
const postsApi = "https://disqus.com/api/3.0/forums/listPosts";

// disqus "forum" names for bio/medrxiv
const forums = ["biorxivstage", "medrxiv"];

async function getComments() {
  // collect all comments from bio/medrxiv
  let items = [];

  for (const forum of forums) {
    // set search params
    const params = new URLSearchParams();
    params.set("api_key", apiKey);
    params.set("forum", forum);
    params.set("related", "thread");
    params.set("limit", 100);

    // hard limit request pages
    for (let page = 0; page < 10; page++) {
      console.log(`Getting page ${page + 1} of comments from ${forum}`);

      // get page of results
      const url = postsApi + "?" + params.toString();
      const { cursor, response } = await (await fetch(url)).json();

      // collect comments
      items = items.concat(response);

      // set next page
      if (cursor?.hasNext) params.set("cursor", cursor?.next);
      else break;
    }
  }

  console.log(`Found ${items.length} total comments`);

  // keep only comment properties we want
  items = items.map(
    ({
      url = "",
      forum = "",
      message = "",
      createdAt = null,
      author = {},
    }) => ({
      url,
      forum,
      keywords: keywords.filter((keyword) =>
        message.toLowerCase().includes(keyword)
      ).length,
      message: stripHtml(message).result,
      date: createdAt,
      username: author.username,
      name: author.name,
    })
  );

  // sort by date
  items = items.sort((a, b) => new Date(a) - new Date(b));

  // keep only last few
  items = items.slice(0, 100);

  // create rules for metascraper to extract metadata from html
  const toRule = (field) => [
    ({ htmlDom }) =>
      Array.from(
        htmlDom(`meta[name="${field}"]`).map(
          (index, node) => node.attribs["content"]
        )
      ).join(", "),
  ];
  const rules = {
    doi: toRule("citation_doi"),
    title: toRule("citation_title"),
    authors: toRule("citation_author"),
    date: toRule("citation_date"),
  };

  // get paper metadata from links
  items = await Promise.all(
    items.map(async ({ url, ...rest }, index) => {
      console.log(`Getting paper metadata of comment ${index + 1}`);

      // fetch html content of link
      const html = await (await fetch(url)).text();

      // extract out metadata from html
      const metadata = await metascraper([rules])({ html, url });

      // split object into comment info and paper info
      return { comment: { url, ...rest }, paper: metadata };
    })
  );

  // output to csv file
  const csv = await jsonexport(items, { headerPathString: " " });
  writeFileSync("output.csv", csv, "utf-8");
}

// run main script
getComments();
