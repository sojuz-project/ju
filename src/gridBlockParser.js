const gqlParser = require('./gqlParser');
const { gql } = require('apollo-server');

const classMap = (entries) =>
  Object.entries(entries || {})
    .map(([key, value]) => `${value}-${key}`)
    .join(' ');

// eslint-disable-next-line complexity
const addAttrs = (newAttrs = {}, block = {}, k = 0) => {
  newAttrs.attrs = {
    ...(newAttrs.attrs || {}),
    className: classMap(block.attrs.class.component[k]),
    style: block.attrs.style.component[k],
  };

  if (newAttrs.blockName == 'coreheading') {
    newAttrs.attrs.tagName = block.attrs.technical.component[k].tagName;
  } else if (newAttrs.blockName == 'customimage') {
    const cell = (block.attrs.technical.component[k].h / block.attrs.technical.block.gridTemplateColumns) * 2;
    newAttrs.attrs.style.height = `${cell}vw`;
    newAttrs.attrs.url = newAttrs.url;
  } else if (newAttrs.blockName == 'customwrapper') {
    const cell = (block.attrs.technical.component[k].h / block.attrs.technical.block.gridTemplateColumns) * 2;
    newAttrs.attrs.style.height = `${cell}vw`;
    newAttrs.attrs.reasignTo = block.attrs.technical.component[k].reasignTo;
  }

  if (block.attrs.data.component[k]) {
    newAttrs.attrs.mapQL = block.attrs.data.component[k].mapQL;
  }

  return newAttrs;
};

const contentParse = (content, tagName = false) => (tagName ? `<${tagName}>${content}</${tagName}>` : content);

module.exports = async (blocks, blockName = '', schema, { page, postSlug, catSlug } = {}, ctx) => {
  const value = await Promise.all(
    // eslint-disable-next-line complexity
    blocks.map(async (block, i) => {
      if (block.blockName == blockName) {
        const skip = ((page || 1) - 1) * block.attrs.content.length;
        const limit = block.attrs.content.length;
        const res = block.attrs.data.block.dataSources
          ? await gqlParser(
              schema,
              block.attrs.data.block.dataSources,
              {
                skip,
                limit,
                ...(postSlug && { name: postSlug }),
                ...(catSlug && { terms: catSlug.split(',') }),
              },
              ctx
            )
          : {};
        const key = Object.keys(res).pop();
        const data = key ? res[key] : [];
        const posts = data && Array.isArray(data) ? data : [data];

        if (block.attrs.data.block.dataSources && data === null) {
          console.log(block.attrs.data.block.dataSources, data);
          throw new Error('Empty data'); // Isn't it nice when throwing error doesn't throw an error?
        }

        return {
          blockName: 'core/columns',
          attrs: {
            columns: block.attrs.technical.block.gridTemplateColumns,
            style: block.attrs.style.block,
            dataSource: block.attrs.data.block.dataSources,
            className: block.attrs.className,
          },
          innerBlocks: block.attrs.content
            .slice(0, block.attrs.data.block.dataSources ? posts.length : block.attrs.content.length)
            .map((columns, j) => ({
              blockName: `core/column`,
              attrs: {
                style: block.attrs.style.section,
              },
              // eslint-disable-next-line complexity
              innerBlocks: columns.map((column, k) => {
                const { attrs: attrsToAdd, blockName = 'core/columns' } = addAttrs(column, block, k);

                return {
                  blockName,
                  attrs: {
                    ...attrsToAdd,
                    ...(posts[j] && {
                      data: posts[j],
                      ...posts[j].thumbnail,
                    }),
                    elementWidth:
                      block.attrs.technical.component[k].w / block.attrs.technical.block.gridTemplateColumns,
                  },
                  innerHTML: contentParse(column.innerHTML, block.attrs.technical.component[k].tagName),
                  ...(posts[j] &&
                    block.attrs.technical.component[k].mapQL &&
                    (column.blockName === 'coreheading' || column.blockName === 'coreparagraph') && {
                      innerHTML: contentParse(
                        posts[j][block.attrs.technical.component[k].mapQL],
                        block.attrs.technical.component[k].tagName
                      ),
                    }),
                };
              }),
            })),
        };
      } else {
        return block;
      }
    })
  );
  return value;
};
