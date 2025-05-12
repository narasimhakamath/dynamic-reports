const express = require("express");
const { v4: uuidv4 } = require("uuid");
const Widget = require("../models/Widget");
const { getConnection } = require("../utils/connectionManager");

const router = express.Router();

// router.post("/", async (req, res) => {
//   const { name, description, type, query, options } = req.body;

//   try {
//     // Generate a unique ID for the widget
//     const widgetId = uuidv4();

//     // Validate query structure
//     if (!query || !query.database || !query.collection || !query.pipeline) {
//       return res.status(400).json({ message: "Invalid query structure" });
//     }

//     // Save widget to the database
//     const widget = new Widget({
//       id: widgetId,
//       name,
//       description,
//       type,
//       query,
//       options,
//     });

//     await widget.save();

//     res
//       .status(201)
//       .json({
//         message: `Widget created successfully: ${widgetId}`,
//       });
//   } catch (err) {
//     console.error(err);
//     res
//       .status(500)
//       .json({ message: "Failed to create the widget", error: err.message });
//   }
// });

router.post("/", async (req, res) => {
  const { query, widget } = req.body;

  try {
    // Generate a unique ID for the widget
    const widgetId = uuidv4();

    // Validate query structure
    if (!query || !query.database || !query.sourceCollection || !query.pipeline) {
      return res.status(400).json({
        message: "Invalid query structure. Ensure 'database', 'sourceCollection', and 'pipeline' are provided.",
      });
    }

    // Validate widget structure
    if (!widget || !widget.name || !widget.type) {
      return res.status(400).json({
        message: "Invalid widget structure. Ensure 'name' and 'type' are provided.",
      });
    }

    // Validate widget type
    const validTypes = ["LINECHART", "BARCHART", "PIECHART"];
    if (!validTypes.includes(widget.type)) {
      return res.status(400).json({
        message: `Invalid widget type. Allowed types are: ${validTypes.join(", ")}`,
      });
    }

    // Save widget to the database
    const newWidget = new Widget({
      id: widgetId,
      query,
      widget,
    });

    await newWidget.save();

    res.status(201).json({
      message: `Widget created successfully: ${widgetId}`,
      id: widgetId,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      message: "Failed to create the widget",
      error: err.message,
    });
  }
});

router.get('/', async (req, res) => {
  try {
    // Fetch all widgets from the database
    const widgets = await Widget.find({});

    // Format the widgets for the response
    const formattedWidgets = widgets.map(widget => ({
      id: widget.id,
      name: widget?.widget?.name,
      description: widget?.widget?.description,
      type: widget?.widget?.type,
      xAxisLabel: widget?.widget?.xAxisLabel,
      yAxisLabel: widget?.widget?.yAxisLabel,
      options: widget?.widget?.options,
    }));

    // Send the formatted widgets as the response
    res.json(formattedWidgets);
  } catch (err) {
    console.error(err);
    res.status(500).json({
      message: 'Failed to fetch widgets list',
      success: false,
      code: 500,
      error: err.message,
    });
  }
});

router.get('/:widgetID', async (req, res) => {
  try {
    const { widgetID } = req.params;

    // Fetch widget metadata
    const widget = await Widget.findOne({ id: widgetID });
    if (!widget) {
      return res.status(404).json({ message: 'Widget not found' });
    }

    const { db } = await getConnection(widget.query.database);
    const collection = db.collection(widget.query.sourceCollection);

    // Execute the pipeline query
    const data = await collection.aggregate(widget.query.pipeline).toArray();

    // Return widget metadata and data
    res.json({
      id: widget?.id,
      name: widget?.widget?.name,
      description: widget?.widget?.description,
      type: widget?.widget?.type,
      xAxisLabel: widget?.widget?.xAxisLabel,
      yAxisLabel: widget?.widget?.yAxisLabel,
      options: widget?.widget?.options,
      data, // Data from the pipeline query
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      message: 'Failed to fetch widget data',
      success: false,
      code: 500,
      error: err.message,
    });
  }
});

module.exports = router;
