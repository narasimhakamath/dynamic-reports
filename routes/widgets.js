const express = require("express");
const { v4: uuidv4 } = require("uuid");
const Widget = require("../models/Widget");
const { getConnection } = require("../utils/connectionManager");

const router = express.Router();

router.post("/", async (req, res) => {
  const { name, description, type, query, options } = req.body;

  try {
    // Generate a unique ID for the widget
    const widgetId = uuidv4();

    // Validate query structure
    if (!query || !query.database || !query.collection || !query.pipeline) {
      return res.status(400).json({ message: "Invalid query structure" });
    }

    // Save widget to the database
    const widget = new Widget({
      id: widgetId,
      name,
      description,
      type,
      query,
      options,
    });

    await widget.save();

    res
      .status(201)
      .json({
        message: `Widget created successfully: ${widgetId}`,
      });
  } catch (err) {
    console.error(err);
    res
      .status(500)
      .json({ message: "Failed to create the widget", error: err.message });
  }
});

router.get('/', async (req, res) => {
    try {
      // Fetch all widgets from the database
      const widgets = await Widget.find({});
  
      // Format the widgets for the response
      const formattedWidgets = widgets.map(widget => ({
        id: widget.id,
        name: widget.name,
        description: widget.description,
        type: widget.type,
        options: widget.options,
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

router.get("/:widgetID", async (req, res) => {
  try {
    const { widgetID } = req.params;

    // Fetch widget metadata
    const widget = await Widget.findOne({ id: widgetID });
    if (!widget) {
      return res.status(404).json({ message: "Widget not found" });
    }

    const { db } = await getConnection(widget.query.database);
    const collection = db.collection(widget.query.collection);

    // Calculate dynamic date range (last 12 months)
    const now = new Date();
    const startDate = new Date(now.getFullYear(), now.getMonth() - 11, 1); // 12 months ago
    const endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0); // End of the current month

    // Replace placeholders in the pipeline with dynamic values
    const pipeline = widget.query.pipeline.map((stage) => {
      if (stage.$match && stage.$match.date) {
        return {
          $match: {
            ...stage.$match,
            date: {
              $gte: startDate,
              $lte: endDate,
            },
          },
        };
      }
      return stage;
    });

    // Execute the query or pipeline
    const data = await collection.aggregate(pipeline).toArray();

    // Return widget metadata and data
    res.json({
      id: widget.id,
      name: widget.name,
      description: widget.description,
      type: widget.type,
      options: widget.options,
      data, // Data for the widget
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      message: "Failed to fetch widget data",
      success: false,
      code: 500,
      error: err.message,
    });
  }
});

module.exports = router;
